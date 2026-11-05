/* Fluxo de pedidos sem reenvio automático. Não comanda portas USB ou relés. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VCNControl = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const ACTIONS = ['abrir', 'fechar'];
  const STATES = ['sending', 'waiting', 'verifying', 'not_found', 'unavailable'];

  function secureUuid() {
    const crypto = globalThis.crypto;
    if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    if (!crypto || typeof crypto.getRandomValues !== 'function') throw new Error('Gerador seguro indisponível');
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  function create(options) {
    const now = options.now || Date.now;
    const schedule = options.setTimeout || setTimeout;
    const cancel = options.clearTimeout || clearTimeout;
    const uuid = options.uuid || secureUuid;
    const storage = options.storage;
    let current = null, last = null, timer = null, generation = 0, revision = 0, refreshing = null, refreshRevision = 0;
    const key = user => 'vcn.pending-command.' + user;
    const snapshot = () => ({ ...(current || last || { phase: 'idle' }), busy: !!current });

    function notify() { if (options.onChange) options.onChange(snapshot()); }
    function save() {
      if (!current || !storage) return;
      try { storage.setItem(key(current.userId), JSON.stringify(current)); } catch (_) {}
    }
    function update(data) { if (current) Object.assign(current, data); save(); notify(); }
    function finish(phase, extra = {}) {
      if (!current) return;
      last = { ...current, ...extra, phase, finishedAt: now() };
      try { if (storage) storage.removeItem(key(current.userId)); } catch (_) {}
      current = null;
      if (timer) cancel(timer);
      timer = null;
      notify();
      if (options.onSettled) options.onSettled(snapshot());
    }
    function plan(delay = 2000) {
      if (timer) cancel(timer);
      if (current) timer = schedule(() => { timer = null; refresh(); }, delay);
    }
    function same(gen, id) { return gen === generation && current && current.id === id; }
    function applyRecord(record) {
      if (!current || !record || record.id !== current.id || record.acao !== current.action) return false;
      const expiry = Date.parse(record.expira_em);
      update({ exists: true, expiresAt: Number.isFinite(expiry) ? expiry : current.expiresAt });
      if (record.executado === true && record.expirado !== true) {
        finish('confirmed', { confirmedAt: record.executado_em || null });
      } else if (record.expirado === true || (Number.isFinite(expiry) && expiry <= now())) {
        finish('expired');
      } else if (typeof record.erro === 'string' && record.erro.trim()) {
        finish('failed', { reason: 'device' });
      } else update({ phase: 'waiting' });
      return true;
    }

    async function refresh() {
      if (!current) return snapshot();
      if (refreshing) {
        const previous = refreshing, previousRevision = refreshRevision;
        await previous;
        if (current && revision !== previousRevision) return refresh();
        return snapshot();
      }
      const gen = generation, id = current.id, user = current.userId, rev = revision;
      const operation = (async () => {
        try {
          const r = await options.request('GET', '/rest/v1/comandos?id=eq.' + encodeURIComponent(id) +
            '&select=id,acao,executado,executado_em,expira_em,expirado,erro&limit=1', null, user);
          if (!same(gen, id) || rev !== revision) return snapshot();
          if (!r.ok || !Array.isArray(r.data)) update({ phase: 'unavailable' });
          else if (!r.data.length) update({ phase: 'not_found', exists: false });
          else if (!applyRecord(r.data[0])) update({ phase: 'unavailable' });
        } catch (_) {
          if (same(gen, id) && rev === revision) update({ phase: 'unavailable' });
        }
        if (same(gen, id) && rev === revision) plan(current.phase === 'waiting' ? 2000 : 5000);
        return snapshot();
      })();
      refreshing = operation; refreshRevision = rev;
      try { return await operation; } finally { if (refreshing === operation) refreshing = null; }
    }

    async function transmit() {
      revision++;
      const gen = generation, id = current.id, user = current.userId;
      update({ phase: 'sending' });
      let r;
      try {
        r = await options.request('POST', '/rest/v1/comandos',
          { id, acao: current.action, usuario_id: user }, user,
          { headers: { Prefer: 'return=representation' }, timeoutMs: 10000 });
      } catch (_) { r = { ok: false, status: 0 }; }
      if (!same(gen, id)) return snapshot();
      // Erro de transporte/servidor é ambíguo: nunca cria outro UUID nem reenvia sozinho.
      if (!r.ok && r.status >= 400 && r.status < 500 && ![408, 409, 429].includes(r.status)) {
        finish('failed', { reason: [401, 403].includes(r.status) ? 'permission' : 'rejected' });
        return snapshot();
      }
      if (r.ok && Array.isArray(r.data) && r.data.length && applyRecord(r.data[0])) {
        if (current) plan();
        return snapshot();
      }
      update({ phase: 'verifying' });
      return refresh();
    }

    async function send(action, userId) {
      if (!ACTIONS.includes(action) || !UUID.test(userId)) throw new Error('Pedido inválido');
      if (current) return snapshot();
      const id = uuid();
      if (!UUID.test(id)) throw new Error('Identificador indisponível');
      last = null;
      current = { id, action, userId, createdAt: now(), phase: 'sending', exists: null };
      save(); notify();
      return transmit();
    }

    async function retry() {
      // A ação é explícita e só é oferecida depois de uma consulta bem-sucedida sem registro.
      // O mesmo UUID impede criar uma segunda linha se a primeira requisição chegar atrasada.
      if (!current || current.phase !== 'not_found' || current.exists !== false) return snapshot();
      if (timer) cancel(timer);
      timer = null;
      return transmit();
    }
    function stop() {
      generation++;
      if (timer) cancel(timer);
      timer = null; current = null; last = null; refreshing = null;
      notify();
    }
    async function restore(userId) {
      if (!UUID.test(userId)) return snapshot();
      if (current && current.userId === userId) return snapshot();
      stop();
      let saved;
      try { saved = storage && JSON.parse(storage.getItem(key(userId))); } catch (_) {}
      if (saved && saved.userId === userId && UUID.test(saved.id) && ACTIONS.includes(saved.action) &&
          STATES.includes(saved.phase) && Number.isFinite(saved.createdAt)) {
        // Não descarta silenciosamente um envio incerto apenas por recarregar a página.
        current = { id: saved.id, action: saved.action, userId,
          createdAt: saved.createdAt, phase: 'verifying', exists: null };
        save(); notify();
        return refresh();
      }
      return snapshot();
    }
    return { send, retry, refresh, restore, stop, snapshot };
  }
  function validConfig(config) {
    return !!config && typeof config.modo_manutencao === 'boolean' &&
      Number.isInteger(config.tempo_pulso_ms) && config.tempo_pulso_ms >= 100 && config.tempo_pulso_ms <= 2000 &&
      Number.isInteger(config.expira_comando_seg) && config.expira_comando_seg >= 5 && config.expira_comando_seg <= 60;
  }
  return Object.freeze({ create, validConfig, validUuid: value => typeof value === 'string' && UUID.test(value) });
});
