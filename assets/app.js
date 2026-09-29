// VCN Control — lógica do app (arquivo externo para permitir CSP sem 'unsafe-inline')
'use strict';
const URL = 'https://hbdfxvscxnjbfntlhkko.supabase.co';
const KEY = 'sb_publishable_UNSze5dx3h5Vxf9Y8U3FYA_YJnkbl7T';

// Helper HTTP direto — sem biblioteca
async function supa(method, path, body, token) {
  const headers = {
    'apikey': KEY,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
  headers['Authorization'] = 'Bearer ' + (token || KEY);

  try {
    const r = await fetch(URL + path, {
      method,
      headers,
      cache: 'no-store',
      body: body ? JSON.stringify(body) : undefined
    });
    const txt = await r.text();
    let data = null;
    if (txt) {
      try { data = JSON.parse(txt); }
      catch { data = txt; }
    }
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      data: { message: e && e.message ? e.message : 'Falha de conexão' }
    };
  }
}

// Auth helpers
async function signIn(email, password) {
  return supa('POST', '/auth/v1/token?grant_type=password', { email, password });
}
async function signUp(email, password, nome) {
  return supa('POST', '/auth/v1/signup?redirect_to=' + encodeURIComponent(APP_URL), { email, password, data: { nome } });
}
// Links de e-mail (confirmação/recuperação) voltam para este mesmo endereço.
const APP_URL = location.origin + location.pathname;
async function getUser(token) {
  return supa('GET', '/auth/v1/user', null, token);
}
async function updateUser(data, token) {
  return supa('PUT', '/auth/v1/user', data, token);
}
async function signOut(token) {
  return supa('POST', '/auth/v1/logout', {}, token);
}
async function refreshSession(refreshToken) {
  return supa('POST', '/auth/v1/token?grant_type=refresh_token', { refresh_token: refreshToken });
}

// DB helpers
async function getPerfil(userId, token) {
  return supa('GET', `/rest/v1/usuarios?id=eq.${userId}&select=*`, null, token);
}
async function getLogs(token) {
  return supa('GET', '/rest/v1/logs?select=acao,executado_em,usuarios(nome,email)&order=executado_em.desc&limit=10', null, token);
}
async function getUsuarios(token) {
  return supa('GET', '/rest/v1/usuarios?select=*&order=criado_em.desc', null, token);
}
async function insertComando(acao, userId, token) {
  return supa('POST', '/rest/v1/comandos', { acao, usuario_id: userId }, token);
}
async function updateUsuario(id, data, token) {
  return supa('PATCH', `/rest/v1/usuarios?id=eq.${id}`, data, token);
}

async function getConfig(token) {
  return supa('GET', '/rest/v1/configuracoes?id=eq.portao_principal&select=*', null, token);
}
async function salvarConfig(data, token) {
  return supa('PATCH', '/rest/v1/configuracoes?id=eq.portao_principal', data, token);
}
async function criarConfigPadrao(token) {
  return supa('POST', '/rest/v1/configuracoes', {
    id: 'portao_principal',
    nome_dispositivo: 'Portão',
    tempo_pulso_ms: 400,
    expira_comando_seg: 30,
    modo_manutencao: false
  }, token);
}
async function enviarComandoAdmin(acao) {
  return supa('POST', '/rest/v1/comandos', { acao, usuario_id: USER_ID }, TOKEN);
}

// Estado
let TOKEN = null, USER_ID = null, PERFIL = null;
let REFRESH = null, PERSIST = false, refreshTimer = null;
let CONFIG = null;
let logTimer = null;
let statusTimer = null;
let perfilTimer = null;

const LOG_REFRESH_MS = 2000;
const STATUS_CHECK_MS = 10000;
// Janela para considerar retorno recente do ESP32.
// Sem heartbeat real, isto evita mostrar online por causa de comando antigo.
const ESP32_ONLINE_WINDOW_MS = 45000;
const PERFIL_RETRY_MS = 2000;
// Painel técnico da tela "aguardando" só aparece com ?debug=1 na URL.
const DEBUG = new URLSearchParams(location.search).get('debug') === '1';
if (DEBUG) document.getElementById('dbg-ag').classList.add('on');

// Utils
function toast(m) {
  const el = document.getElementById('toast');
  el.textContent = m; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}
function setMsg(id, txt, tipo) {
  const el = document.getElementById(id);
  el.textContent = txt;
  el.className = 'msg ' + tipo;
}
function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function limparTimers() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  if (logTimer) clearInterval(logTimer);
  if (statusTimer) clearInterval(statusTimer);
  if (perfilTimer) clearTimeout(perfilTimer);
  logTimer = null;
  statusTimer = null;
  perfilTimer = null;
}
function agendarPerfil() {
  if (perfilTimer) clearTimeout(perfilTimer);
  perfilTimer = setTimeout(() => {
    perfilTimer = null;
    carregarPerfil();
  }, PERFIL_RETRY_MS);
}
function tela(id) {
  document.querySelectorAll('.tela').forEach(t => t.classList.remove('ativa'));
  document.getElementById(id).classList.add('ativa');
}
function fmt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'agora';
  if (diff < 3600000) return Math.floor(diff/60000) + 'min atrás';
  // Usa fuso local do dispositivo automaticamente
  if (diff < 86400000) return d.toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Belem'
  });
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Belem'
  });
}

// Renovação automática do token (Supabase expira o access_token em ~1h)
function agendarRenovacao(expiresInSeg) {
  if (refreshTimer) clearTimeout(refreshTimer);
  const seg = Math.max(30, (Number(expiresInSeg) || 3600) - 120);
  refreshTimer = setTimeout(renovarToken, seg * 1000);
}
async function renovarToken() {
  refreshTimer = null;
  if (!REFRESH) return false;
  const r = await refreshSession(REFRESH);
  if (r.ok && r.data && r.data.access_token) {
    TOKEN = r.data.access_token;
    salvarSessao(TOKEN, USER_ID, r.data.refresh_token || REFRESH, PERSIST);
    agendarRenovacao(r.data.expires_in);
    return true;
  }
  if (r.status === 0) { agendarRenovacao(150); return false; } // sem rede: tenta de novo
  return false;
}
function aplicarSessao(data, persistir) {
  TOKEN = data.access_token;
  USER_ID = data.user.id;
  salvarSessao(TOKEN, USER_ID, data.refresh_token, persistir);
  agendarRenovacao(data.expires_in);
}

// Persistência de sessão
// Segurança: não salvamos senha. Para manter conectado, salvamos o refresh_token do Supabase.
function salvarSessao(token, userId, refreshToken, persistir) {
  REFRESH = refreshToken || REFRESH;
  PERSIST = !!persistir;
  try {
    const storage = persistir ? localStorage : sessionStorage;
    const outro = persistir ? sessionStorage : localStorage;

    storage.setItem('tok', token || '');
    storage.setItem('uid', userId || '');
    if (refreshToken) storage.setItem('refresh', refreshToken);
    storage.setItem('persist', persistir ? '1' : '0');

    outro.removeItem('tok');
    outro.removeItem('uid');
    outro.removeItem('refresh');
    outro.removeItem('persist');
  } catch(e){}
}
function carregarSessao() {
  try {
    const local = {
      token: localStorage.getItem('tok'),
      userId: localStorage.getItem('uid'),
      refreshToken: localStorage.getItem('refresh'),
      persistir: localStorage.getItem('persist') === '1'
    };
    if (local.refreshToken || (local.token && local.userId)) return local;

    return {
      token: sessionStorage.getItem('tok'),
      userId: sessionStorage.getItem('uid'),
      refreshToken: sessionStorage.getItem('refresh'),
      persistir: false
    };
  } catch(e){ return {}; }
}
function limparSessao() {
  try {
    ['tok','uid','refresh','persist'].forEach(k => {
      sessionStorage.removeItem(k);
      localStorage.removeItem(k);
    });
    localStorage.removeItem('vcn_keep_login');
  } catch(e){}
}

// Login
document.getElementById('ir-cad').onclick = () => {
  document.getElementById('c-login').style.display = 'none';
  document.getElementById('c-cad').style.display = 'flex';
};
document.getElementById('ir-login').onclick = () => {
  document.getElementById('c-cad').style.display = 'none';
  document.getElementById('c-login').style.display = 'flex';
};

// Recuperação de senha
document.getElementById('btn-esqueci').onclick = async () => {
  const email = document.getElementById('l-email').value.trim();
  if (!email) {
    setMsg('m-login', 'Digite seu e-mail acima primeiro', 'erro');
    return;
  }
  const btn = document.getElementById('btn-esqueci');
  btn.textContent = 'Enviando...';
  btn.disabled = true;

  const r = await supa('POST', '/auth/v1/recover?redirect_to=' + encodeURIComponent(APP_URL), { email });

  btn.disabled = false;
  btn.textContent = 'Esqueci minha senha';

  if (r.ok || r.status === 200) {
    setMsg('m-login', 'E-mail de recuperação enviado! Verifique sua caixa de entrada.', 'ok');
  } else {
    setMsg('m-login', 'Erro ao enviar e-mail. Verifique o endereço digitado.', 'erro');
  }
};

function toggleLembrar() {
  const cb = document.getElementById('lembrar');
  const box = document.getElementById('lembrar-box');
  const check = document.getElementById('lembrar-check');
  cb.checked = !cb.checked;
  box.setAttribute('aria-checked', cb.checked ? 'true' : 'false');
  if (cb.checked) {
    box.style.background = 'var(--brand-600)';
    check.style.display = 'block';
  } else {
    box.style.background = 'var(--bg3)';
    check.style.display = 'none';
  }
}

// Carrega preferências salvas ao abrir
window.addEventListener('DOMContentLoaded', () => {
  try {
    const emailSalvo = localStorage.getItem('vcn_email') || '';
    const manterConectado = localStorage.getItem('vcn_keep_login') === '1';

    if (emailSalvo) {
      document.getElementById('l-email').value = emailSalvo;
    }

    if (manterConectado) {
      document.getElementById('lembrar').checked = true;
      document.getElementById('lembrar-box').style.background = 'var(--brand-600)';
      document.getElementById('lembrar-box').setAttribute('aria-checked', 'true');
      document.getElementById('lembrar-check').style.display = 'block';
    }

    // Limpeza de segurança: versões antigas não devem manter senha em localStorage.
    localStorage.removeItem('vcn_creds');
  } catch(e) {}
});

document.getElementById('btn-entrar').onclick = async () => {
  const email = document.getElementById('l-email').value.trim();
  const senha = document.getElementById('l-senha').value;
  const lembrar = document.getElementById('lembrar').checked;
  if (!email || !senha) return setMsg('m-login','Preencha todos os campos','erro');
  const btn = document.getElementById('btn-entrar');
  btn.disabled = true; btn.textContent = 'Entrando...';
  const r = await signIn(email, senha);
  btn.disabled = false; btn.textContent = 'Entrar';
  if (!r.ok) { setMsg('m-login','E-mail ou senha incorretos','erro'); return; }
  // Salva preferência de login sem gravar senha no navegador.
  try {
    if (lembrar) {
      localStorage.setItem('vcn_email', email);
      localStorage.setItem('vcn_keep_login', '1');
    } else {
      localStorage.removeItem('vcn_email');
      localStorage.removeItem('vcn_keep_login');
    }
  } catch(e) {}
  aplicarSessao(r.data, lembrar);
  document.getElementById('l-senha').value = '';
  await carregarPerfil();
};

document.getElementById('btn-cad').onclick = async () => {
  const nome  = document.getElementById('c-nome').value.trim();
  const email = document.getElementById('c-email').value.trim();
  const senha = document.getElementById('c-senha').value;
  if (!nome||!email||!senha) return setMsg('m-cad','Preencha todos os campos','erro');
  if (senha.length < 6) return setMsg('m-cad','Senha mínimo 6 caracteres','erro');
  const btn = document.getElementById('btn-cad');
  btn.disabled = true; btn.textContent = 'Criando...';
  const r = await signUp(email, senha, nome);
  btn.disabled = false; btn.textContent = 'Criar conta';
  if (!r.ok) {
    console.error('Erro ao criar conta:', r.status, r.data);

    let msg = 'Erro ao criar conta';

    if (r.data) {
      if (r.data.msg) msg = r.data.msg;
      else if (r.data.message) msg = r.data.message;
      else if (r.data.error_description) msg = r.data.error_description;
      else if (r.data.error) msg = r.data.error;
      else msg = JSON.stringify(r.data);
    }

    const msgLower = String(msg).toLowerCase();

    if (msgLower.includes('already') || msgLower.includes('registered') || msgLower.includes('user already')) {
      msg = 'Este e-mail já possui cadastro. Use “Entrar” ou “Esqueci minha senha”.';
    } else if (msgLower.includes('password') || msgLower.includes('senha')) {
      msg = 'Senha recusada. Use pelo menos 6 caracteres, com letras e números.';
    } else if (msgLower.includes('rate') || msgLower.includes('too many')) {
      msg = 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
    } else if (msgLower.includes('email')) {
      msg = 'E-mail recusado ou inválido. Confira se foi digitado corretamente.';
    } else if (r.status === 0) {
      msg = 'Falha de conexão. Verifique a internet e tente novamente.';
    } else {
      msg = msg + ' (código ' + r.status + ')';
    }

    setMsg('m-cad', msg, 'erro');
    return;
  }
  setMsg('m-cad','Conta criada! Confirme seu e-mail para entrar.','ok');
};

async function sair() {
  const tokenAtual = TOKEN;
  limparTimers();
  TOKEN = null; USER_ID = null; PERFIL = null; REFRESH = null;
  limparSessao();

  if (tokenAtual) await signOut(tokenAtual);

  document.getElementById('btn-adm').style.display = 'none';
  document.getElementById('btn-abrir').disabled = true;
  document.getElementById('btn-fechar').disabled = true;
  document.getElementById('s-dot').className = 'dot';
  document.getElementById('s-txt').textContent = 'Verificando conexão...';
  document.getElementById('sec-log').style.display = 'none';
  // Mantém apenas o e-mail se "lembrar" estava marcado.
  tela('t-login');
}
document.getElementById('btn-sair').onclick    = sair;
document.getElementById('btn-sair-ag').onclick = sair;

// Carregar perfil
async function carregarPerfil(jaRenovou = false) {
  if (!TOKEN || !USER_ID) return;

  const r = await getPerfil(USER_ID, TOKEN);
  const dbg = DEBUG ? document.getElementById('dbg-ag') : null;

  if ((r.status === 401 || r.status === 403) && !jaRenovou && await renovarToken()) return carregarPerfil(true);
  if (r.status === 401 || r.status === 403) {
    setMsg('m-login', 'Sessão expirada. Entre novamente.', 'erro');
    await sair();
    return;
  }

  if (!r.ok || !r.data || r.data.length === 0) {
    // Perfil ainda não criado pelo trigger — aguarda
    if (dbg) dbg.textContent = 'Aguardando perfil... status:' + r.status + ' ' + JSON.stringify(r.data);
    tela('t-ag');
    agendarPerfil();
    return;
  }

  PERFIL = r.data[0];

  if (!PERFIL.aprovado) {
    if (dbg) dbg.textContent = 'ID:' + PERFIL.id + ' aprovado:' + PERFIL.aprovado + ' admin:' + PERFIL.admin;
    tela('t-ag');
    agendarPerfil();
    return;
  }

  if (perfilTimer) {
    clearTimeout(perfilTimer);
    perfilTimer = null;
  }

  // Aprovado — tela principal
  document.getElementById('u-nome').textContent = PERFIL.nome || PERFIL.email || 'Usuário';
  document.getElementById('btn-adm').style.display = PERFIL.admin ? 'inline-flex' : 'none';
  document.getElementById('btn-abrir').disabled  = false;
  document.getElementById('btn-fechar').disabled = false;
  tela('t-app');
  await carregarConfigSilencioso();

  // Log só para admin
  const secLog = document.getElementById('sec-log');
  if (PERFIL.admin === true) {
    secLog.style.display = 'block';
    secLog.style.visibility = 'visible';
    await carregarLogs();
    contarPendentes();
    if (logTimer) clearInterval(logTimer);
    logTimer = setInterval(() => { if (!document.hidden) carregarLogs(); }, LOG_REFRESH_MS);
  } else {
    secLog.style.display = 'none';
    secLog.style.visibility = 'hidden';
    if (logTimer) clearInterval(logTimer);
    logTimer = null;
  }

  await verificarStatus();
  if (statusTimer) clearInterval(statusTimer);
  statusTimer = setInterval(() => { if (!document.hidden) verificarStatus(); }, STATUS_CHECK_MS);
}

// Comandos
async function enviarComando(acao) {
  if (!['abrir', 'fechar'].includes(acao)) {
    toast('Ação inválida bloqueada por segurança.');
    return;
  }
  if (CONFIG && CONFIG.modo_manutencao && (!PERFIL || PERFIL.admin !== true)) {
    toast('Sistema em manutenção. Tente mais tarde.');
    return;
  }
  if (!navigator.onLine) {
    toast('Sem internet — comando não enviado');
    return;
  }
  document.getElementById('btn-abrir').disabled  = true;
  document.getElementById('btn-fechar').disabled = true;
  try { navigator.vibrate && navigator.vibrate(30); } catch(e) {}

  let r = await insertComando(acao, USER_ID, TOKEN);
  if ((r.status === 401 || r.status === 403) && await renovarToken()) {
    r = await insertComando(acao, USER_ID, TOKEN);
  }

  setTimeout(() => {
    if (!TOKEN) return; // saiu nesse meio-tempo
    document.getElementById('btn-abrir').disabled  = false;
    document.getElementById('btn-fechar').disabled = false;
  }, 3000);

  if (!r.ok) {
    let msg = 'Falha ao enviar comando';
    if (r.status === 401 || r.status === 403) msg = (CONFIG && CONFIG.modo_manutencao) ? 'Portão em manutenção' : 'Sem permissão para enviar comando';
    else if (r.status === 0) msg = 'Falha de conexão';
    else if (r.data && (r.data.message || r.data.msg)) msg = r.data.message || r.data.msg;
    toast(msg);
    return;
  }

  // Não marque como online aqui.
  // O app só pode mostrar retorno quando o ESP32 realmente marcar o comando como executado no banco.
  toast(acao === 'abrir' ? '🔓 Comando de abrir enviado' : '🔒 Comando de fechar enviado');
  if (PERFIL && PERFIL.admin === true) {
    document.getElementById('s-dot').className = 'dot';
    document.getElementById('s-txt').textContent = 'Comando enviado — aguardando confirmação do ESP32';
  }

  // O histórico só deve atualizar quando o ESP32 confirmar no banco.
  setTimeout(carregarLogs, 2000);
  setTimeout(verificarStatus, 2000);
  setTimeout(carregarLogs, 5000);
  setTimeout(verificarStatus, 5000);
}

function adicionarLogImediato(acao) {
  if (!PERFIL || !PERFIL.admin) return;
  const lista = document.getElementById('log-lista');
  if (!lista) return;
  const nome = esc(PERFIL.nome || PERFIL.email || 'Você');
  const badge = acao === 'abrir'
    ? '<span class="badge ba2">Abriu</span>'
    : '<span class="badge bf2">Fechou</span>';
  const item = document.createElement('div');
  item.className = 'li';
  item.innerHTML = `<div><div class="q">${nome}</div><div class="w">agora</div></div>${badge}`;
  lista.insertBefore(item, lista.firstChild);
  // Remove entradas antigas se passar de 15
  while (lista.children.length > 15) lista.removeChild(lista.lastChild);
}
document.getElementById('btn-abrir').onclick  = () => enviarComando('abrir');
document.getElementById('btn-fechar').onclick = () => enviarComando('fechar');

// Logs
async function carregarLogs() {
  if (!PERFIL || PERFIL.admin !== true || !TOKEN) return;
  const lista = document.getElementById('log-lista');
  if (!lista) return;

  // Busca comandos executados com join em usuarios
  const r = await supa('GET',
    '/rest/v1/comandos?executado=eq.true&acao=in.(abrir,fechar)&order=executado_em.desc.nullslast&limit=15&select=acao,criado_em,executado_em,usuario_id,usuarios!comandos_usuario_id_fkey(nome,email)',
    null, TOKEN);
  if (!r.ok || !r.data || r.data.length === 0) {
    lista.innerHTML = '<div class="empty">Nenhum acesso ainda</div>';
    return;
  }
  lista.innerHTML = r.data.map(l => {
    let quem = 'Dispositivo';
    if (l.usuarios) {
      quem = l.usuarios.nome || l.usuarios.email || 'Usuário';
    } else if (l.usuario_id) {
      quem = 'ID: ' + String(l.usuario_id).substring(0,8) + '...';
    }
    const badge = l.acao === 'abrir'
      ? '<span class="badge ba2">Abriu</span>'
      : '<span class="badge bf2">Fechou</span>';
    return `<div class="li"><div><div class="q">${esc(quem)}</div><div class="w">${esc(fmt(l.executado_em || l.criado_em))}</div></div>${badge}</div>`;
  }).join('');
}

// Admin
function abrirPainelAdmin(nome) {
  if (!PERFIL || PERFIL.admin !== true) {
    toast('Acesso restrito ao administrador');
    tela('t-app');
    return;
  }
  const usuarios = document.getElementById('painel-usuarios');
  const config = document.getElementById('painel-config');
  const tabUsuarios = document.getElementById('tab-usuarios');
  const tabConfig = document.getElementById('tab-config');
  const cfg = nome === 'config';
  usuarios.classList.toggle('ativa', !cfg);
  config.classList.toggle('ativa', cfg);
  tabUsuarios.classList.toggle('ativa', !cfg);
  tabConfig.classList.toggle('ativa', cfg);
  tabUsuarios.setAttribute('aria-pressed', String(!cfg));
  tabConfig.setAttribute('aria-pressed', String(cfg));
}

document.getElementById('tab-usuarios').onclick = async () => {
  abrirPainelAdmin('usuarios');
  await carregarUsuarios();
};
document.getElementById('tab-config').onclick = async () => {
  abrirPainelAdmin('config');
  await carregarConfigAdmin();
};
document.getElementById('btn-adm').onclick  = async () => {
  if (!PERFIL || PERFIL.admin !== true) return toast('Acesso restrito ao administrador');
  tela('t-admin');
  abrirPainelAdmin('usuarios');
  await carregarUsuarios();
};
document.getElementById('btn-back').onclick = () => tela('t-app');


async function carregarConfigSilencioso() {
  if (!TOKEN) return;
  const r = await getConfig(TOKEN);
  if (r.ok && Array.isArray(r.data) && r.data.length) {
    CONFIG = r.data[0];
    if (CONFIG.nome_dispositivo) {
      const h2 = document.getElementById('t-dispositivo');
      if (h2) h2.textContent = CONFIG.nome_dispositivo;
    }
    return;
  }
  CONFIG = null;
}

async function carregarConfigAdmin() {
  if (!PERFIL || PERFIL.admin !== true) return toast('Acesso restrito');
  let r = await getConfig(TOKEN);

  if (r.ok && Array.isArray(r.data) && r.data.length === 0) {
    await criarConfigPadrao(TOKEN);
    r = await getConfig(TOKEN);
  }

  if (!r.ok || !Array.isArray(r.data) || !r.data.length) {
    toast('Configuração não encontrada. Rode o SQL complementar.');
    return;
  }

  CONFIG = r.data[0];
  document.getElementById('cfg-nome').value = CONFIG.nome_dispositivo || 'Portão';
  document.getElementById('cfg-pulso').value = CONFIG.tempo_pulso_ms || 400;
  document.getElementById('cfg-expira').value = CONFIG.expira_comando_seg || 30;
  document.getElementById('cfg-manut').checked = !!CONFIG.modo_manutencao;
  document.getElementById('cfg-st-manut').textContent = CONFIG.modo_manutencao ? 'Ativo' : 'Desligado';
  document.getElementById('cfg-st-pulso').textContent = (CONFIG.tempo_pulso_ms || 400) + ' ms';
  await atualizarResumoUltimaAcaoAdmin();
}

async function atualizarResumoUltimaAcaoAdmin() {
  const r = await supa('GET', '/rest/v1/comandos?executado=eq.true&acao=in.(abrir,fechar)&order=executado_em.desc.nullslast&limit=1&select=acao,executado_em,criado_em', null, TOKEN);
  const elHora = document.getElementById('cfg-ult-acao');
  const elTipo = document.getElementById('cfg-ult-tipo');
  if (!elHora || !elTipo) return;
  if (!r.ok || !r.data || !r.data.length) {
    elHora.textContent = 'Nenhuma';
    elTipo.textContent = '—';
    return;
  }
  elHora.textContent = fmt(r.data[0].executado_em || r.data[0].criado_em);
  elTipo.textContent = r.data[0].acao || '—';
}

document.getElementById('btn-recarregar-config').onclick = carregarConfigAdmin;
document.getElementById('btn-salvar-config').onclick = async () => {
  if (!PERFIL || PERFIL.admin !== true) return toast('Acesso restrito');
  const nome = document.getElementById('cfg-nome').value.trim() || 'Portão';
  const pulso = Math.max(100, Math.min(2000, Number(document.getElementById('cfg-pulso').value || 400)));
  const expira = Math.max(5, Math.min(60, Number(document.getElementById('cfg-expira').value || 30)));
  const manut = document.getElementById('cfg-manut').checked;
  const r = await salvarConfig({
    nome_dispositivo: nome,
    tempo_pulso_ms: pulso,
    expira_comando_seg: expira,
    modo_manutencao: manut,
    atualizado_em: new Date().toISOString(),
    atualizado_por: USER_ID
  }, TOKEN);
  if (!r.ok) return toast('Erro ao salvar: ' + JSON.stringify(r.data));
  toast('Configurações salvas');
  await carregarConfigAdmin();
  await carregarConfigSilencioso();
};

document.getElementById('btn-modo-wifi').onclick = async () => {
  if (!PERFIL || PERFIL.admin !== true) return toast('Acesso restrito');
  if (!confirm('Solicitar modo configuração Wi-Fi ao ESP32? Só funciona se o firmware estiver preparado.')) return;
  const r = await salvarConfig({ modo_config_wifi: true, atualizado_em: new Date().toISOString(), atualizado_por: USER_ID }, TOKEN);
  toast(r.ok ? 'Solicitação de Wi-Fi registrada' : 'Falha ao registrar solicitação');
};

document.getElementById('btn-reiniciar-esp').onclick = async () => {
  if (!PERFIL || PERFIL.admin !== true) return toast('Acesso restrito');
  if (!confirm('Reiniciar o ESP32? Só funciona se o firmware estiver preparado.')) return;
  const r = await enviarComandoAdmin('reiniciar_esp32');
  if (r.ok) return toast('Comando de reinício enviado');
  const m = JSON.stringify(r.data || '');
  toast(m.includes('check') || m.includes('23514') ? 'Reinício ainda não habilitado no banco/firmware' : 'Falha ao enviar reinício');
};

async function carregarUsuarios() {
  const r = await getUsuarios(TOKEN);
  const lista = document.getElementById('lista-u');
  if (!r.ok || !Array.isArray(r.data) || r.data.length === 0) {
    lista.innerHTML = '<div class="empty">Nenhum usuário</div>'; return;
  }
  atualizarPendentes(r.data);

  // Separa o perfil do administrador logado dos demais usuários.
  const eu        = r.data.find(u => u.id === USER_ID);
  const outros    = r.data.filter(u => u.id !== USER_ID);
  const admins    = outros.filter(u => u.admin === true);
  const pendentes = outros.filter(u => u.admin !== true && !u.aprovado);
  const ativos    = outros.filter(u => u.admin !== true && u.aprovado);

  const inicial = u => esc(String(u.nome || u.email || '?').trim().charAt(0).toUpperCase() || '?');
  const cartao = (u, acoes, extra = '') => `
    <div class="uc${extra}">
      <div class="avatar" aria-hidden="true">${inicial(u)}</div>
      <div class="uc-info"><div class="n">${esc(u.nome || '(sem nome)')}</div><div class="e">${esc(u.email || '')}</div></div>
      ${acoes}
    </div>`;
  const secao = (titulo, itens, vazio) => `
    <section class="u-sec" aria-label="${titulo}">
      <div class="sec-title">${titulo} <span class="u-count">${itens.length}</span></div>
      ${itens.length ? itens.join('') : `<div class="empty">${vazio}</div>`}
    </section>`;

  let html = '';
  if (eu) {
    html += `<section class="u-sec" aria-label="Meu perfil">
      <div class="sec-title">Meu perfil</div>
      ${cartao(eu, '<span class="role-badge">ADMIN</span>', ' uc-me')}
    </section>`;
  }
  if (admins.length) {
    html += secao('Administradores', admins.map(u => cartao(u, '<span class="role-badge">ADMIN</span>')), '');
  }
  html += secao('Aguardando aprovação', pendentes.map(u => cartao(u,
    `<div class="uac"><button class="bap" data-acao="aprovar" data-id="${esc(u.id)}">Aprovar</button></div>`)),
    'Nenhuma solicitação pendente');
  html += secao('Usuários ativos', ativos.map(u => cartao(u,
    `<div class="uac"><button class="brm" data-acao="remover" data-id="${esc(u.id)}">Revogar</button></div>`)),
    'Nenhum usuário comum ativo');
  lista.innerHTML = html;
}

// ---- STATUS ESP32 ----
async function verificarStatus() {
  if (!TOKEN) return;

  const dot = document.getElementById('s-dot');
  const txt = document.getElementById('s-txt');
  const bar = document.getElementById('sbar');
  if (!navigator.onLine) {
    bar.classList.add('offline');
    dot.className = 'dot';
    txt.textContent = 'Sem internet — verifique sua conexão';
    return;
  }
  bar.classList.remove('offline');

  await carregarConfigSilencioso();
  const manut = !!(CONFIG && CONFIG.modo_manutencao);
  bar.classList.toggle('offline', manut);

  // Usuário comum: não consulta nem exibe o histórico de comandos (só para admin).
  if (!PERFIL || PERFIL.admin !== true) {
    document.getElementById('btn-abrir').disabled  = manut;
    document.getElementById('btn-fechar').disabled = manut;
    dot.className = manut ? 'dot' : 'dot on';
    txt.textContent = manut ? 'Portão em manutenção — comandos bloqueados' : 'Conectado — pronto para uso';
    return;
  }
  if (manut) {
    dot.className = 'dot';
    txt.textContent = 'Modo manutenção ativo — só administradores podem acionar';
    return;
  }

  const r = await supa('GET',
    '/rest/v1/comandos?executado=eq.true&acao=in.(abrir,fechar)&order=executado_em.desc.nullslast&limit=1&select=executado_em,criado_em,acao',
    null, TOKEN);

  if (!r.ok) {
    dot.className = 'dot';
    txt.textContent = 'Não foi possível verificar a última ação confirmada';
    return;
  }

  if (!r.data || r.data.length === 0) {
    dot.className = 'dot';
    txt.textContent = 'Nenhuma ação confirmada ainda';
    return;
  }

  const retornoIso = r.data[0].executado_em || r.data[0].criado_em;

  if (!r.data[0].executado_em) {
    dot.className = 'dot';
    txt.textContent = 'Último comando confirmado sem horário — verifique trigger/ESP32';
    return;
  }

  const ultimo = new Date(retornoIso);
  const idade = Date.now() - ultimo.getTime();

  if (idade <= ESP32_ONLINE_WINDOW_MS) {
    dot.className = 'dot on';
    txt.textContent = 'Último comando confirmado — ' + fmt(retornoIso);
    return;
  }

  dot.className = 'dot';
  txt.textContent = 'Último comando confirmado — ' + fmt(retornoIso);
}

async function aprovar(id) {
  const r = await updateUsuario(id, { aprovado: true }, TOKEN);
  toast(r.ok ? 'Usuário aprovado' : 'Falha ao aprovar usuário');
  await carregarUsuarios();
}
async function remover(id) {
  if (!confirm('Revogar o acesso deste usuário? Ele voltará para "aguardando aprovação".')) return;
  const r = await updateUsuario(id, { aprovado: false }, TOKEN);
  toast(r.ok ? 'Acesso revogado' : 'Falha ao revogar acesso');
  await carregarUsuarios();
}
function atualizarPendentes(lista) {
  const el = document.getElementById('adm-pend');
  if (!el) return;
  const n = Array.isArray(lista) ? lista.filter(u => !u.aprovado).length : 0;
  el.textContent = n;
  el.hidden = n === 0;
}
async function contarPendentes() {
  if (!PERFIL || PERFIL.admin !== true || !TOKEN) return;
  const r = await supa('GET', '/rest/v1/usuarios?aprovado=eq.false&select=id', null, TOKEN);
  if (r.ok) atualizarPendentes(r.data.map(() => ({ aprovado: false })));
}

// Enter envia formulários
function aoEnter(ids, acao) {
  ids.forEach(id => document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); acao(); }
  }));
}
aoEnter(['l-email'], () => document.getElementById('l-senha').focus());
aoEnter(['l-senha'], () => document.getElementById('btn-entrar').click());
aoEnter(['c-nome'], () => document.getElementById('c-email').focus());
aoEnter(['c-email'], () => document.getElementById('c-senha').focus());
aoEnter(['c-senha'], () => document.getElementById('btn-cad').click());

// Mostrar/ocultar senha
document.querySelectorAll('.pw-toggle').forEach(btn => {
  btn.onclick = () => {
    const input = document.getElementById(btn.dataset.pw);
    const mostrar = input.type === 'password';
    input.type = mostrar ? 'text' : 'password';
    btn.setAttribute('aria-pressed', String(mostrar));
    btn.setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
  };
});

// Conexão e visibilidade: atualiza ao voltar, economiza bateria em segundo plano
window.addEventListener('online', () => { toast('Conexão restabelecida'); verificarStatus(); carregarLogs(); });
window.addEventListener('offline', () => { toast('Sem internet'); verificarStatus(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !TOKEN || !PERFIL) return;
  verificarStatus();
  carregarLogs();
  contarPendentes();
});

// Restaurar sessão ao carregar
// Trata o retorno dos links enviados por e-mail (#access_token=...&type=recovery|signup)
async function tratarRetornoEmail() {
  if (!location.hash || location.hash.length < 2) return false;
  const h = new URLSearchParams(location.hash.slice(1));
  // Remove tokens da barra de endereço imediatamente (não ficam no histórico).
  history.replaceState(null, '', APP_URL + location.search);

  if (h.get('error') || h.get('error_description')) {
    tela('t-login');
    setMsg('m-login', h.get('error_code') === 'otp_expired'
      ? 'Link expirado. Peça um novo em "Esqueci minha senha".'
      : 'Link inválido ou já utilizado. Tente novamente.', 'erro');
    return true;
  }
  const access = h.get('access_token');
  if (!access) return false;

  const u = await getUser(access);
  if (!u.ok || !u.data || !u.data.id) {
    tela('t-login');
    setMsg('m-login', 'Não foi possível validar o link. Tente novamente.', 'erro');
    return true;
  }
  const sessao = {
    access_token: access,
    refresh_token: h.get('refresh_token'),
    expires_in: Number(h.get('expires_in')) || 3600,
    user: u.data
  };

  if (h.get('type') === 'recovery') {
    PENDENTE_RECUPERACAO = sessao;
    document.getElementById('c-login').style.display = 'none';
    document.getElementById('c-cad').style.display = 'none';
    document.getElementById('c-nova').style.display = 'flex';
    tela('t-login');
    document.getElementById('n-senha').focus();
    return true;
  }

  // Confirmação de cadastro / link mágico: entra direto.
  aplicarSessao(sessao, false);
  toast('E-mail confirmado');
  await carregarPerfil();
  return true;
}

let PENDENTE_RECUPERACAO = null;
document.getElementById('btn-nova').onclick = async () => {
  const s1 = document.getElementById('n-senha').value;
  const s2 = document.getElementById('n-senha2').value;
  if (!PENDENTE_RECUPERACAO) return setMsg('m-nova', 'Link de recuperação inválido. Peça um novo.', 'erro');
  if (s1.length < 6) return setMsg('m-nova', 'A senha precisa ter pelo menos 6 caracteres', 'erro');
  if (s1 !== s2) return setMsg('m-nova', 'As senhas não conferem', 'erro');
  const btn = document.getElementById('btn-nova');
  btn.disabled = true; btn.textContent = 'Salvando...';
  const r = await updateUser({ password: s1 }, PENDENTE_RECUPERACAO.access_token);
  btn.disabled = false; btn.textContent = 'Salvar nova senha';
  if (!r.ok) {
    const m = String((r.data && (r.data.msg || r.data.message || r.data.error_description)) || '').toLowerCase();
    setMsg('m-nova', m.includes('different') || m.includes('same')
      ? 'A nova senha precisa ser diferente da anterior'
      : r.status === 0 ? 'Falha de conexão. Tente novamente.' : 'Não foi possível salvar a senha. Peça um novo link.', 'erro');
    return;
  }
  document.getElementById('n-senha').value = '';
  document.getElementById('n-senha2').value = '';
  document.getElementById('c-nova').style.display = 'none';
  document.getElementById('c-login').style.display = 'flex';
  aplicarSessao(PENDENTE_RECUPERACAO, false);
  PENDENTE_RECUPERACAO = null;
  toast('Senha alterada com sucesso');
  await carregarPerfil();
};
aoEnter(['n-senha'], () => document.getElementById('n-senha2').focus());
aoEnter(['n-senha2'], () => document.getElementById('btn-nova').click());

window.addEventListener('load', async () => {
  if (await tratarRetornoEmail()) return;
  const s = carregarSessao();

  // Se o usuário marcou "manter conectado", renova a sessão com refresh_token.
  if (s.refreshToken) {
    const r = await refreshSession(s.refreshToken);
    if (r.ok && r.data && r.data.access_token && r.data.user) {
      if (!r.data.refresh_token) r.data.refresh_token = s.refreshToken;
      aplicarSessao(r.data, s.persistir);
      await carregarPerfil();
      return;
    }
    // Sem rede: mantém a sessão salva e tenta de novo quando voltar a conexão.
    if (r.status === 0) {
      setMsg('m-login', 'Sem conexão. Vamos reconectar automaticamente quando a internet voltar.', 'erro');
      tela('t-login');
      window.addEventListener('online', () => location.reload(), { once: true });
      return;
    }
    // Refresh falhou — sessão corrompida ou expirada, limpa tudo
    limparSessao();
    setMsg('m-login', 'Sessão expirada. Entre novamente.', 'erro');
    tela('t-login');
    return;
  }

  // Sessão temporária da aba atual.
  if (s.token && s.userId) {
    // Testa se o token ainda é válido antes de usar
    const r = await getPerfil(s.userId, s.token);
    if (r.status === 401 || r.status === 403 || !r.ok) {
      limparSessao();
      tela('t-login');
      return;
    }
    TOKEN = s.token;
    USER_ID = s.userId;
    REFRESH = s.refreshToken || null;
    PERSIST = false;
    if (REFRESH) agendarRenovacao(600);
    await carregarPerfil();
    return;
  }

  // Nenhuma sessão — garante tela de login limpa
  limparSessao();
  tela('t-login');
});

// Listeners que antes eram atributos inline (onclick/onkeydown)
document.getElementById('lembrar-box').addEventListener('click', toggleLembrar);
document.getElementById('lembrar-box').addEventListener('keydown', e => {
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleLembrar(); }
});
document.getElementById('lembrar-lbl').addEventListener('click', toggleLembrar);
document.getElementById('lista-u').addEventListener('click', e => {
  const btn = e.target.closest('button[data-acao]');
  if (!btn) return;
  if (btn.dataset.acao === 'aprovar') aprovar(btn.dataset.id);
  else if (btn.dataset.acao === 'remover') remover(btn.dataset.id);
});

// ---- SERVICE WORKER ----
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('./service-worker.js');
    } catch (e) {
      console.error('SW erro:', e);
    }
  });
}

// ---- PWA INSTALL BANNER ----
(function () {
  const STORAGE_KEY = 'vcn-pwa-dismissed';

  // Não mostra se já foi dispensado há menos de 7 dias
  function foiDispensado() {
    const t = localStorage.getItem(STORAGE_KEY);
    if (!t) return false;
    return Date.now() - Number(t) < 7 * 24 * 60 * 60 * 1000;
  }

  function criarBanner(innerHTML, onInstall, onFechar) {
    if (document.getElementById('pwa-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'pwa-banner';
    banner.style.cssText = [
      'position:fixed','bottom:24px','left:50%','transform:translateX(-50%)',
      'background:rgba(6,20,38,0.97)','color:#f1f5f9',
      'border:1px solid rgba(8,102,255,0.35)',
      'border-radius:20px','padding:18px 20px',
      'display:flex','flex-direction:column','gap:14px',
      'z-index:9999','width:calc(100% - 40px)','max-width:370px',
      'box-shadow:0 8px 40px rgba(0,0,0,0.7),0 0 0 1px rgba(8,102,255,0.1)',
      'backdrop-filter:blur(16px)','-webkit-backdrop-filter:blur(16px)',
      'font-family:var(--font)',
      'animation:slideUp .3s ease'
    ].join(';');

    // Injeta keyframe uma vez
    if (!document.getElementById('pwa-kf')) {
      const s = document.createElement('style');
      s.id = 'pwa-kf';
      s.textContent = '@keyframes slideUp{from{opacity:0;transform:translateX(-50%) translateY(20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}';
      document.head.appendChild(s);
    }

    banner.innerHTML = innerHTML;
    document.body.appendChild(banner);

    if (onInstall) {
      const btnI = document.getElementById('pwa-btn-instalar');
      if (btnI) btnI.onclick = onInstall;
    }
    const btnF = document.getElementById('pwa-btn-fechar');
    if (btnF) btnF.onclick = () => {
      localStorage.setItem(STORAGE_KEY, Date.now());
      banner.remove();
      if (onFechar) onFechar();
    };
  }

  // ---- ANDROID / CHROME ----
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;

    if (foiDispensado()) return;

    criarBanner(
      `<div style="display:flex;align-items:center;gap:12px">
        <div style="width:44px;height:44px;border-radius:12px;background:#061426;border:1px solid rgba(16,168,255,0.4);overflow:hidden;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <img src="./assets/icon-192.png" alt="" style="width:40px;height:40px;border-radius:10px">
        </div>
        <div>
          <div style="font-size:15px;font-weight:700">Instalar VCN Control</div>
          <div style="font-size:12px;color:#8A9BB5;margin-top:2px">Adicionar à tela inicial</div>
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button id="pwa-btn-instalar" style="flex:1;padding:13px;background:linear-gradient(135deg,#10A8FF,#0866FF 55%,#173ED5);color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 4px 16px rgba(8,102,255,0.4)">Instalar</button>
        <button id="pwa-btn-fechar" style="padding:13px 16px;background:rgba(255,255,255,0.05);color:#94a3b8;border:1px solid rgba(255,255,255,0.08);border-radius:12px;font-size:14px;font-weight:600;cursor:pointer">Agora não</button>
      </div>`,
      async () => {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        deferredPrompt = null;
        document.getElementById('pwa-banner')?.remove();
      }
    );
  });

  // ---- iOS / SAFARI ----
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true;

  if (isIOS && !isStandalone && !foiDispensado()) {
    setTimeout(() => {
      criarBanner(
        `<div style="display:flex;align-items:center;gap:12px">
          <div style="width:44px;height:44px;border-radius:12px;background:#061426;border:1px solid rgba(16,168,255,0.4);overflow:hidden;display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <img src="./assets/icon-192.png" alt="" style="width:40px;height:40px;border-radius:10px">
          </div>
          <div>
            <div style="font-size:15px;font-weight:700">Instalar VCN Control</div>
            <div style="font-size:12px;color:#8A9BB5;margin-top:2px">Adicionar à tela inicial</div>
          </div>
        </div>
        <div style="font-size:13px;color:#94a3b8;line-height:1.6;background:rgba(255,255,255,0.04);border-radius:12px;padding:12px 14px">
          Toque em <strong style="color:#f1f5f9">Compartilhar</strong>
          <span style="font-size:16px"> ⬆</span> na barra do Safari e depois em
          <strong style="color:#f1f5f9">"Adicionar à Tela de Início"</strong>
        </div>
        <button id="pwa-btn-fechar" style="width:100%;padding:13px;background:rgba(255,255,255,0.05);color:#94a3b8;border:1px solid rgba(255,255,255,0.08);border-radius:12px;font-size:14px;font-weight:600;cursor:pointer">Entendido</button>`
      );
    }, 2000);
  }
})();
