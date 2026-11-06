'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createPresence}=require('../assets/control.js');
const user='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const response=(online=true,age=100)=>({ok:true,status:200,data:{online,age_ms:online?age:null,valid_for_ms:5000}});
function setup(handler=()=>response()) {
  let clock=0,serial=0,active=true;const timers=new Map(),calls=[],changes=[];
  const monitor=createPresence({now:()=>clock,canPoll:()=>active,
    setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:clock+ms});return id;},clearTimeout:id=>timers.delete(id),
    request:(...args)=>{calls.push(args);return handler(...args);},onChange:s=>changes.push(s)});
  async function advance(ms) {
    const end=clock+ms;
    for(let steps=0;steps<500;steps++) {
      const first=[...timers.entries()].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!first)break;
      clock=first[1].at;timers.delete(first[0]);first[1].fn();for(let i=0;i<20;i++)await Promise.resolve();
    }
    clock=end;
  }
  return {monitor,timers,calls,changes,advance,active:value=>{active=value;}};
}
test('permanece Online por minutos sem qualquer acionamento',async()=>{
  const s=setup();await s.monitor.start(user);await s.advance(120000);
  assert.equal(s.monitor.snapshot().online,true);assert.ok(s.calls.length>=60);assert.ok(s.timers.size<=2);
  assert.ok(s.calls.every(c=>c[0]==='GET'&&c[1]==='/rest/v1/rpc/vcn_device_status'&&c[2]===null));
  assert.ok(s.changes.every(c=>c.online));
});
test('desconexão e reconexão são atualizadas sem criar pedidos',async()=>{
  let connected=true;const s=setup(()=>response(connected));await s.monitor.start(user);
  connected=false;await s.advance(2000);assert.equal(s.monitor.snapshot().online,false);
  connected=true;await s.advance(2000);assert.equal(s.monitor.snapshot().online,true);
  assert.ok(s.calls.every(c=>c[0]==='GET'));
});
test('sem nova resposta, a última presença expira durante uma requisição pendente',async()=>{
  let calls=0,resolve;const s=setup(()=>++calls===1?response():new Promise(r=>{resolve=r;}));
  await s.monitor.start(user);await s.advance(8000);assert.equal(s.monitor.snapshot().online,false);
  resolve(response());for(let i=0;i<20;i++)await Promise.resolve();assert.equal(s.monitor.snapshot().online,false);
});
test('verificações concorrentes compartilham a mesma requisição',async()=>{
  let resolve;const s=setup(()=>new Promise(r=>{resolve=r;}));const a=s.monitor.start(user),b=s.monitor.refresh();
  assert.equal(s.calls.length,1);resolve(response());await Promise.all([a,b]);assert.equal(s.monitor.snapshot().online,true);
});
test('erro de transporte mostra Offline e usa recuo de cinco segundos',async()=>{
  const s=setup(()=>{throw Error('rede');});await s.monitor.start(user);
  assert.deepEqual(s.monitor.snapshot(),{online:false,reason:'unavailable'});
  await s.advance(4999);assert.equal(s.calls.length,1);await s.advance(1);assert.equal(s.calls.length,2);
});
test('resposta antiga não restaura Online depois de sair',async()=>{
  let resolve;const s=setup(()=>new Promise(r=>{resolve=r;}));const pending=s.monitor.start(user);s.monitor.stop();
  resolve(response());await pending;assert.equal(s.monitor.snapshot().online,false);assert.equal(s.timers.size,0);
});
test('troca de conta ignora respostas da sessão anterior',async()=>{
  const resolvers=[];const s=setup(()=>new Promise(r=>{resolvers.push(r);}));
  const a=s.monitor.start(user),b=s.monitor.start(other);resolvers[0](response());await a;
  assert.equal(s.monitor.snapshot().online,false);resolvers[1](response());await b;
  assert.equal(s.monitor.snapshot().online,true);assert.deepEqual(s.calls.map(c=>c[3]),[user,other]);
});
test('campos inválidos, sinal vencido e TTL inesperado não declaram Online',async()=>{
  for(const data of [{online:'true',age_ms:0,valid_for_ms:5000},{online:true,age_ms:-1,valid_for_ms:5000},
    {online:true,age_ms:5000,valid_for_ms:5000},{online:true,age_ms:null,valid_for_ms:5000},
    {online:true,age_ms:0,valid_for_ms:30000}]) {
    const s=setup(()=>({ok:true,data}));await s.monitor.start(user);assert.equal(s.monitor.snapshot().online,false);
  }
});
test('aba oculta ou navegador sem rede suspende consultas; retorno verifica imediatamente',async()=>{
  const s=setup();s.active(false);await s.monitor.start(user);assert.equal(s.calls.length,0);
  await s.advance(10000);assert.equal(s.calls.length,0);s.active(true);await s.monitor.refresh();
  assert.equal(s.calls.length,1);assert.equal(s.monitor.snapshot().online,true);
});
test('identidade inválida não inicia monitoramento',()=>{
  const s=setup();assert.throws(()=>s.monitor.start('invalido'));assert.equal(s.calls.length,0);
});
