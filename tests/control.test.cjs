'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../assets/control.js');
const user = '11111111-1111-4111-8111-111111111111';
const other = '33333333-3333-4333-8333-333333333333';
const id = '22222222-2222-4222-8222-222222222222';
const now = Date.parse('2026-11-05T23:00:00Z');
const waiting = { id, acao: 'abrir', executado: false, expirado: false, expira_em: new Date(now + 30000).toISOString() };
function setup(handler, storage = new Map()) {
  const calls = [], timers = [];
  let ids = 0;
  const controller = create({
    now: () => now, uuid: () => { ids++; return id; },
    storage: { getItem:k => storage.get(k) || null, setItem:(k,v) => storage.set(k,v), removeItem:k => storage.delete(k) },
    request: async (...args) => { calls.push(args); return handler(...args); },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {}
  });
  return { controller, calls, storage, timers, ids: () => ids };
}
test('aceitação HTTP não é confirmação; acompanha o UUID correto', async () => {
  const s = setup(async method => ({ ok:true, status:method==='POST'?201:200, data:[waiting] }));
  await s.controller.send('abrir', user);
  assert.equal(s.controller.snapshot().phase, 'waiting');
  assert.equal(s.controller.snapshot().busy, true);
  await s.controller.refresh();
  assert.ok(s.calls[1][1].includes('id=eq.' + id));
  assert.deepEqual(s.calls[0][2], { id, acao:'abrir', usuario_id:user });
});
test('impede envio concorrente enquanto o primeiro aguarda a rede', async () => {
  let resolve;
  const s=setup(()=>new Promise(r=>{resolve=r;}));
  const first=s.controller.send('abrir',user);
  await s.controller.send('fechar',user);
  assert.equal(s.calls.length,1); assert.equal(s.ids(),1);
  resolve({ok:true,status:201,data:[waiting]}); await first;
});
test('confirmação encerra o pedido e limpa persistência', async () => {
  let confirmed=false;
  const s=setup(async()=>({ok:true,status:200,data:[confirmed?{...waiting,executado:true,executado_em:new Date(now).toISOString()}:waiting]}));
  await s.controller.send('abrir',user); confirmed=true; await s.controller.refresh();
  assert.equal(s.controller.snapshot().phase,'confirmed'); assert.equal(s.controller.snapshot().busy,false); assert.equal(s.storage.size,0);
});
test('prazo vencido encerra sem emitir outro POST', async () => {
  const s=setup(async()=>({ok:true,status:201,data:[{...waiting,expira_em:new Date(now-1).toISOString()}]}));
  await s.controller.send('abrir',user); assert.equal(s.controller.snapshot().phase,'expired'); assert.equal(s.calls.length,1);
});
test('timeout ambíguo só consulta; repetição explícita conserva UUID e ação', async () => {
  const s=setup(async method=>method==='POST'?{ok:false,status:0,timeout:true}:{ok:true,status:200,data:[]});
  await s.controller.send('abrir',user);
  assert.equal(s.controller.snapshot().phase,'not_found');
  assert.deepEqual(s.calls.map(c=>c[0]),['POST','GET']);
  await s.controller.retry();
  const posts=s.calls.filter(c=>c[0]==='POST'); assert.equal(posts.length,2); assert.deepEqual(posts[0][2],posts[1][2]); assert.equal(s.ids(),1);
});
test('negação 403 não faz reenvio nem confirmação', async () => {
  const s=setup(async()=>({ok:false,status:403,data:null}));
  await s.controller.send('abrir',user); assert.equal(s.controller.snapshot().phase,'failed'); assert.equal(s.calls.length,1);
});
test('restauração após recarregar só consulta e não retransmite', async () => {
  const storage=new Map(); const s=setup(async()=>({ok:true,status:201,data:[waiting]}),storage);
  await s.controller.send('abrir',user);s.controller.stop();
  const resumed=setup(async()=>({ok:true,status:200,data:[waiting]}),storage);await resumed.controller.restore(user);
  assert.equal(resumed.calls.length,1); assert.equal(resumed.calls[0][0],'GET');assert.equal(resumed.controller.snapshot().phase,'waiting');
});
test('não restaura dados de outro usuário nem estado manipulado', async () => {
  const storage=new Map([['vcn.pending-command.'+user,JSON.stringify({id,action:'apagar',userId:other,createdAt:now,phase:'waiting'})]]);
  const s=setup(async()=>{throw Error('não chamar rede');},storage);await s.controller.restore(user);
  assert.equal(s.calls.length,0);assert.equal(s.controller.snapshot().phase,'idle');
});
test('ignora resposta antiga depois de sair da conta', async () => {
  let resolve;const s=setup(()=>new Promise(r=>{resolve=r;}));
  const sent=s.controller.send('abrir',user);s.controller.stop();resolve({ok:true,status:201,data:[waiting]});await sent;
  assert.equal(s.controller.snapshot().phase,'idle');
});
test('dados de outro pedido nunca confirmam o pedido local', async () => {
  const s=setup(async()=>({ok:true,status:201,data:[{...waiting,id:other,executado:true}]}));
  await s.controller.send('abrir',user);assert.notEqual(s.controller.snapshot().phase,'confirmed');assert.equal(s.controller.snapshot().busy,true);
});
test('ações/identidades inválidas não chegam à rede', async () => {
  const s=setup(async()=>({ok:true,data:[]}));
  await assert.rejects(s.controller.send('reiniciar_esp32',user));await assert.rejects(s.controller.send('abrir','not-an-id'));assert.equal(s.calls.length,0);
});
test('consulta anterior não desfaz uma repetição explícita já aceita', async () => {
  let gets=0, posts=0, resolveOld;
  const s=setup(async method=>{
    if(method==='POST')return ++posts===1?{ok:false,status:0}:{ok:true,status:201,data:[waiting]};
    gets++;if(gets===2)return new Promise(r=>{resolveOld=r;});return {ok:true,status:200,data:[]};
  });
  await s.controller.send('abrir',user);
  const old=s.controller.refresh();await s.controller.retry();
  resolveOld({ok:true,status:200,data:[]});await old;
  assert.equal(s.controller.snapshot().phase,'waiting');assert.equal(posts,2);
});
test('navegador sem randomUUID usa getRandomValues sem depender de Math.random', async () => {
  const fs=require('node:fs'),vm=require('node:vm');
  const sandbox={module:{exports:{}},crypto:{getRandomValues:bytes=>{bytes.fill(7);return bytes;}},setTimeout:()=>1,clearTimeout(){}};
  vm.createContext(sandbox);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../assets/control.js'),'utf8'),sandbox);
  let sentId;
  const c=sandbox.module.exports.create({request:async(method,path,body)=>{if(body)sentId=body.id;return {ok:false,status:403};}});
  await c.send('abrir',user);assert.match(sentId,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
test('primeira confirmação é imediata e consultas seguintes usam 250 ms',async()=>{
  const s=setup(async()=>({ok:true,status:200,data:[waiting]}));
  await s.controller.send('abrir',user);assert.equal(s.timers.at(-1).ms,0);
  await s.controller.refresh();assert.equal(s.timers.at(-1).ms,250);
  assert.equal(s.calls.filter(c=>c[0]==='POST').length,1);
});
test('rede indisponível mantém recuo de cinco segundos e não reenvia',async()=>{
  const s=setup(async method=>method==='POST'?{ok:true,status:201,data:[waiting]}:{ok:false,status:503});
  await s.controller.send('abrir',user);await s.controller.refresh();
  assert.equal(s.timers.at(-1).ms,5000);assert.equal(s.calls.filter(c=>c[0]==='POST').length,1);
});
test('verificações rápidas não sobrepõem requisições',async()=>{
  let resolve,gets=0;
  const s=setup(async method=>method==='POST'?{ok:true,status:201,data:[waiting]}:(gets++,new Promise(r=>{resolve=r;})));
  await s.controller.send('abrir',user);const a=s.controller.refresh(),b=s.controller.refresh();assert.equal(gets,1);
  resolve({ok:true,status:200,data:[waiting]});await Promise.all([a,b]);assert.equal(gets,1);
});
test('intervalos sobem para 500 e 1000 ms sem aumentar carga em espera longa',async()=>{
  let elapsed=0;const timers=[];
  const c=create({now:()=>now+elapsed,uuid:()=>id,setTimeout:(fn,ms)=>{timers.push(ms);return timers.length;},clearTimeout(){},
    request:async()=>({ok:true,status:200,data:[waiting]})});
  await c.send('abrir',user);elapsed=6000;await c.refresh();assert.equal(timers.at(-1),500);
  elapsed=16000;await c.refresh();assert.equal(timers.at(-1),1000);
});
