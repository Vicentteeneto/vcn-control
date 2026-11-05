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
  const document={getElementById(id){if(!nodes.has(id))nodes.set(id,{disabled:false,hidden:false,textContent:'',innerHTML:'',className:'',classList:{add(){},remove(){},toggle(){}}});return nodes.get(id);}};
  const context={ document,TOKEN:'session',USER_ID:'11111111-1111-4111-8111-111111111111',PERFIL:{admin:false,aprovado:true},CONFIG:null,CONFIG_OK:false,
    navigator:{onLine:true},pedidos:{snapshot:()=>({phase:'idle',busy:false})},VCNControl:core,Date,Array,Number,String,JSON,
    async requisicaoAutenticada(){return {ok:false,status:500,data:null};},ultimoHistoricoHtml:'',fmt(){return '';},fmtDataHora(){return '';},esc:x=>String(x) };
  vm.createContext(context);return {context,nodes};
}
const controls=section('function atualizarBotoesComando()','async function enviarComando(acao)');
const config=section('async function carregarConfigSilencioso()','async function carregarConfigAdmin()');
const status=section('async function verificarStatus()','async function aprovar(id)');
test('erro de configuração bloqueia novos pedidos e não declara conexão do ESP32',async()=>{
  const s=ui();vm.runInContext(controls+'\n'+config+'\n'+status,s.context);await s.context.verificarStatus();
  assert.equal(s.nodes.get('btn-abrir').disabled,true);assert.match(s.nodes.get('s-txt').textContent,/Não foi possível/);assert.doesNotMatch(s.nodes.get('s-txt').textContent,/pronto para uso/);
});
test('servidor disponível não é tratado como heartbeat do dispositivo',async()=>{
  const s=ui();s.context.requisicaoAutenticada=async()=>({ok:true,status:200,data:[{modo_manutencao:false,nome_dispositivo:'Portão',tempo_pulso_ms:400,expira_comando_seg:30}]});
  vm.runInContext(controls+'\n'+config+'\n'+status,s.context);await s.context.verificarStatus();
  assert.equal(s.nodes.get('btn-abrir').disabled,false);assert.match(s.nodes.get('s-txt').textContent,/ESP32 sem verificação/);assert.match(s.nodes.get('s-dot').className,/warn/);
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
