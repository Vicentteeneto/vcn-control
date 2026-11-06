'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../assets/app.js'), 'utf8');
const core = require('../assets/control.js');
function section(a,b) { const start=source.indexOf(a), end=source.indexOf(b,start+a.length); assert.ok(start>=0 && end>start); return source.slice(start,end); }
function ui() {
  const nodes=new Map();
  const document={getElementById(id){if(!nodes.has(id))nodes.set(id,{disabled:false,hidden:false,textContent:'',innerHTML:'',className:'',style:{},setAttribute(){},classList:{add(){},remove(){},toggle(){}}});return nodes.get(id);}};
  const context={ document,TOKEN:'session',USER_ID:'11111111-1111-4111-8111-111111111111',PERFIL:{admin:false,aprovado:true},CONFIG:null,CONFIG_OK:false,
    navigator:{onLine:true},pedidos:{snapshot:()=>({phase:'idle',busy:false})},configEmAndamento:null,VCNControl:core,Date,Array,Number,String,JSON,
    arduinoConfirmadoAte:0,arduinoConfirmacaoTimer:null,ARDUINO_ONLINE_MS:30000,
    setTimeout:()=>1,clearTimeout(){},
    async requisicaoAutenticada(){return {ok:false,status:500,data:null};},ultimoHistoricoHtml:'',fmt(){return '';},fmtDataHora(){return '';},esc:x=>String(x) };
  vm.createContext(context);return {context,nodes};
}
const controls=section('function atualizarBotoesComando()','async function enviarComando(acao)');
const config=section('async function carregarConfigSilencioso()','async function carregarConfigAdmin()');
const status=section('async function verificarStatus()','async function aprovar(id)');
test('erro de configuração bloqueia novos pedidos e não declara conexão do ESP32',async()=>{
  const s=ui();vm.runInContext(controls+'\n'+config+'\n'+status,s.context);await s.context.verificarStatus();
  assert.equal(s.nodes.get('btn-abrir').disabled,true);assert.equal(s.nodes.get('s-txt').textContent,'Arduino: sem sinal recente');
});
test('servidor disponível não é tratado como heartbeat do dispositivo',async()=>{
  const s=ui();s.context.requisicaoAutenticada=async()=>({ok:true,status:200,data:[{modo_manutencao:false,nome_dispositivo:'Portão',tempo_pulso_ms:400,expira_comando_seg:30}]});
  vm.runInContext(controls+'\n'+config+'\n'+status,s.context);await s.context.verificarStatus();
  assert.equal(s.nodes.get('btn-abrir').disabled,false);assert.equal(s.nodes.get('s-txt').textContent,'Arduino: sem sinal recente');assert.match(s.nodes.get('s-dot').className,/warn/);
});
test('configuração recebida fora dos limites também bloqueia novos pedidos',async()=>{
  for(const invalid of [{tempo_pulso_ms:9999},{tempo_pulso_ms:null},{expira_comando_seg:120},{modo_manutencao:'false'}]){
    const s=ui();s.context.requisicaoAutenticada=async()=>({ok:true,status:200,data:[{modo_manutencao:false,tempo_pulso_ms:400,expira_comando_seg:30,...invalid}]});
    vm.runInContext(controls+'\n'+config+'\n'+status,s.context);await s.context.verificarStatus();assert.equal(s.nodes.get('btn-abrir').disabled,true);
  }
});
test('manutenção bloqueia usuário comum e mantém a exceção de administrador',async()=>{
  const s=ui();s.context.CONFIG_OK=true;s.context.CONFIG={modo_manutencao:true};vm.runInContext(controls,s.context);
  s.context.atualizarBotoesComando();assert.equal(s.nodes.get('btn-abrir').disabled,true);
  s.context.PERFIL.admin=true;s.context.atualizarBotoesComando();assert.equal(s.nodes.get('btn-abrir').disabled,false);
});
test('offline ou pedido pendente não permitem novo envio',()=>{
  const s=ui();s.context.CONFIG_OK=true;s.context.CONFIG={modo_manutencao:false};vm.runInContext(controls,s.context);
  s.context.navigator.onLine=false;s.context.atualizarBotoesComando();assert.equal(s.nodes.get('btn-abrir').disabled,true);
  s.context.navigator.onLine=true;s.context.pedidos.snapshot=()=>({phase:'waiting',busy:true});s.context.atualizarBotoesComando();assert.equal(s.nodes.get('btn-abrir').disabled,true);
});
test('erro de histórico preserva dados anteriores e apresenta erro',async()=>{
  const s=ui();s.context.PERFIL.admin=true;s.context.ultimoHistoricoHtml='<div>Registro anterior</div>';s.context.supa=async()=>({ok:false,status:500});
  vm.runInContext(section('async function carregarLogs()','// Admin'),s.context);await s.context.carregarLogs();
  assert.match(s.nodes.get('log-lista').innerHTML,/Não foi possível/);assert.match(s.nodes.get('log-lista').innerHTML,/Registro anterior/);
});
const http=section('async function supa(method, path, body, token, options = {})','// Auth helpers');
test('publishable key usa apikey; Authorization recebe somente a sessão',async()=>{
  const calls=[];const c={URL:'https://example.test',KEY:'sb_publishable_public',AbortController,setTimeout,clearTimeout,Number,JSON,
    fetch:async(...args)=>{calls.push(args);return {ok:true,status:200,text:async()=>'[]'};}};vm.createContext(c);vm.runInContext(http,c);
  await c.supa('GET','/rest/v1/comandos',null,null);await c.supa('GET','/rest/v1/comandos',null,'user-jwt');
  assert.equal(calls[0][1].headers.apikey,'sb_publishable_public');assert.equal(calls[0][1].headers.Authorization,undefined);assert.equal(calls[1][1].headers.Authorization,'Bearer user-jwt');
});
test('timeout encerra uma requisição pendente sem expor resposta privada',async()=>{
  const c={URL:'https://example.test',KEY:'public',AbortController,setTimeout,clearTimeout,Number,JSON,
    fetch:async(_,o)=>new Promise((resolve,reject)=>o.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))))};
  vm.createContext(c);vm.runInContext(http,c);const r=await c.supa('GET','/pending',null,null,{timeoutMs:10});
  assert.equal(r.status,0);assert.equal(r.timeout,true);assert.equal(r.data.message,'Tempo de resposta esgotado');
});
test('renovações concorrentes compartilham uma única chamada',async()=>{
  let resolve,calls=0;const c={renovarEmAndamento:null,REFRESH:'refresh',USER_ID:'user',TOKEN:'old',PERSIST:false,
    refreshSession:()=>{calls++;return new Promise(r=>{resolve=r;});},salvarSessao(){},agendarRenovacao(){}};
  vm.createContext(c);vm.runInContext(section('async function renovarToken()','function aplicarSessao('),c);
  const a=c.renovarToken(),b=c.renovarToken();assert.equal(calls,1);resolve({ok:true,data:{access_token:'new',refresh_token:'rotated',expires_in:3600}});
  assert.equal(await a,true);assert.equal(await b,true);assert.equal(c.TOKEN,'new');
});
test('configurações simultâneas compartilham a consulta; próxima verificação lê dados novos',async()=>{
  const s=ui();let resolve,calls=0;
  s.context.requisicaoAutenticada=()=>{calls++;return new Promise(r=>{resolve=r;});};
  vm.runInContext(controls+'\n'+config,s.context);
  const a=s.context.carregarConfigSilencioso(),b=s.context.carregarConfigSilencioso();
  assert.equal(calls,1);
  resolve({ok:true,data:[{modo_manutencao:false,tempo_pulso_ms:400,expira_comando_seg:30}]});
  assert.deepEqual(await Promise.all([a,b]),[true,true]);
  const c=s.context.carregarConfigSilencioso();assert.equal(calls,2);
  resolve({ok:false,status:403});assert.equal(await c,false);assert.equal(s.nodes.get('btn-abrir').disabled,true);
});
test('histórico não compete com a consulta de pedido em andamento',async()=>{
  const s=ui();s.context.PERFIL.admin=true;s.context.pedidos.snapshot=()=>({busy:true});
  s.context.supa=()=>{throw Error('Histórico deveria aguardar');};
  vm.runInContext(section('async function carregarLogs()','// Admin'),s.context);await s.context.carregarLogs();
});
test('estados do pedido não escrevem mensagens na barra da placa',()=>{
  const s=ui();s.context.definirStatus=()=>{throw Error('Pedido não deve alterar status da placa');};
  vm.runInContext(section('function mostrarEstadoPedido()','async function enviarComando(acao)'),s.context);
  for(const phase of ['sending','waiting','confirmed','expired','not_found','unavailable']) {
    s.context.pedidos.snapshot=()=>({phase,busy:phase!=='confirmed'&&phase!=='expired'});
    s.context.mostrarEstadoPedido();
  }
});
test('abertura faz uma verificação e não espera pelo histórico',async()=>{
  const s=ui();let configurations=0,restores=0,logs=0,profileReads=0;const timers=[];
  const profile={ok:true,data:[{admin:true,aprovado:true}]};
  Object.assign(s.context,{getPerfil:async()=>{profileReads++;return profile;},tela(){},
    verificarStatus:async()=>{configurations++;},carregarLogs:()=>{logs++;return new Promise(()=>{});},
    contarPendentes(){},atualizarBotoesComando(){},setInterval:fn=>{timers.push(fn);return timers.length;},clearInterval(){},
    perfilTimer:null,logTimer:null,statusTimer:null,DEBUG:false,LOG_REFRESH_MS:2000,STATUS_CHECK_MS:10000});
  s.context.pedidos.restore=async()=>{restores++;};
  vm.runInContext(section('async function carregarPerfil(','// A interface acompanha'),s.context);
  await s.context.carregarPerfil();
  assert.equal(configurations,1);assert.equal(restores,1);assert.equal(logs,1);assert.equal(timers.length,2);
  await s.context.carregarPerfil(false,profile);assert.equal(profileReads,1);
});
function presenceUi() {
  const s=ui(),timers=[];let clock=Date.parse('2026-11-06T22:00:00Z');
  s.context.Date=class extends Date{static now(){return clock;}};
  s.context.setTimeout=(fn,ms)=>{timers.push({fn,ms});return timers.length;};
  s.context.clearTimeout=id=>{timers[id-1].cancelled=true;};
  vm.runInContext(controls+'\n'+config+'\n'+status,s.context);
  return {...s,timers,setClock:value=>{clock=value;},clock:()=>clock,
    ack:()=>({phase:'confirmed',userId:s.context.USER_ID,confirmedAt:new Date(clock).toISOString()})};
}
test('confirmação recente torna a placa Online e consulta de configuração não sobrescreve',async()=>{
  const s=presenceUi();assert.equal(s.context.registrarConfirmacaoArduino(s.ack()),true);
  assert.equal(s.nodes.get('s-txt').textContent,'Arduino: Online');assert.equal(s.nodes.get('s-dot').className,'dot on');
  s.context.requisicaoAutenticada=async()=>({ok:true,data:[{modo_manutencao:false,tempo_pulso_ms:400,expira_comando_seg:30}]});
  await s.context.verificarStatus();assert.equal(s.nodes.get('s-txt').textContent,'Arduino: Online');
});
test('presença expira mesmo sem outra consulta ou outro pedido',()=>{
  const s=presenceUi();s.context.registrarConfirmacaoArduino(s.ack());
  assert.equal(s.timers.length,1);assert.equal(s.timers[0].ms,30001);
  s.setClock(s.clock()+30001);s.timers[0].fn();
  assert.equal(s.nodes.get('s-txt').textContent,'Arduino: sem sinal recente');assert.equal(s.nodes.get('s-dot').className,'dot warn');
});
test('aceite, confirmação antiga, data futura ou outra conta não declaram Online',()=>{
  const s=presenceUi(),ack=s.ack();
  for(const invalid of [{...ack,phase:'waiting'},{...ack,confirmedAt:null},{...ack,confirmedAt:'inválido'},
    {...ack,confirmedAt:new Date(s.clock()-30000).toISOString()},{...ack,confirmedAt:new Date(s.clock()+6000).toISOString()},
    {...ack,userId:'22222222-2222-4222-8222-222222222222'}])assert.equal(s.context.registrarConfirmacaoArduino(invalid),false);
  s.context.atualizarStatusArduino();assert.equal(s.nodes.get('s-txt').textContent,'Arduino: sem sinal recente');assert.equal(s.timers.length,0);
});
test('callback de confirmação anterior não modifica presença de resposta mais recente',()=>{
  const s=presenceUi();s.context.registrarConfirmacaoArduino(s.ack());const first=s.timers[0];
  s.setClock(s.clock()+10000);s.context.registrarConfirmacaoArduino(s.ack());assert.equal(first.cancelled,true);
  s.setClock(s.clock()+20001);first.fn();assert.equal(s.nodes.get('s-txt').textContent,'Arduino: Online');
  s.setClock(s.clock()+10000);s.timers[1].fn();assert.equal(s.nodes.get('s-txt').textContent,'Arduino: sem sinal recente');
});
test('sair apaga presença e cancela validade; outra conta começa sem sinal',async()=>{
  const s=presenceUi();s.context.registrarConfirmacaoArduino(s.ack());
  Object.assign(s.context,{refreshTimer:null,logTimer:null,statusTimer:null,perfilTimer:null,
    REFRESH:null,limparSessao(){},signOut:async()=>({ok:true}),tela(){}});
  s.context.pedidos.stop=()=>{};
  vm.runInContext(section('function limparTimers()','function agendarPerfil()')+'\n'+section('async function sair()','document.getElementById(\'btn-sair\')'),s.context);
  await s.context.sair();assert.equal(s.context.arduinoConfirmadoAte,0);assert.equal(s.timers[0].cancelled,true);
  s.context.TOKEN='outra-sessao';s.context.USER_ID='22222222-2222-4222-8222-222222222222';s.context.atualizarStatusArduino();
  assert.equal(s.nodes.get('s-txt').textContent,'Arduino: sem sinal recente');
});
