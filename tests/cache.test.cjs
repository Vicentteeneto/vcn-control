'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
function worker(){
  const handlers={},removed=[];
  const sandbox={URL,fetch:async()=>({network:true}),caches:{keys:async()=>['outro-app-v1','vcn-control-v20'],delete:async key=>{removed.push(key);},open:async()=>({match:async key=>key==='./index.html'?{shell:true}:undefined,addAll:async()=>{}})},
    self:{location:{origin:'https://example.test'},registration:{scope:'https://example.test/vcn/'},clients:{claim:async()=>{}},skipWaiting:async()=>{},addEventListener:(type,fn)=>{handlers[type]=fn;}}};
  vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(root,'service-worker.js'),'utf8'),sandbox);return {handlers,removed};
}
test('nova versão não apaga caches de outros aplicativos',async()=>{
  const s=worker();let task;s.handlers.activate({waitUntil:p=>{task=p;}});await task;assert.deepEqual(s.removed,['vcn-control-v20']);
});
test('worker não intercepta autenticação ou comandos do servidor',()=>{
  const s=worker();for(const request of [{method:'POST',url:'https://example.test/vcn/'},{method:'GET',url:'https://backend.test/rest/v1/comandos'},{method:'GET',url:'https://example.test/outro-app/'}]){
    s.handlers.fetch({request,respondWith(){throw Error('Requisição indevida interceptada');}});
  }
});
test('navegação usa o shell da mesma versão dos scripts',async()=>{
  const s=worker();let response;s.handlers.fetch({request:{method:'GET',url:'https://example.test/vcn/',mode:'navigate'},respondWith:p=>{response=p;}});
  assert.equal((await response).shell,true);
});
test('scripts referenciados são cópias exatas com hash do código atual',()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const refs=[...html.matchAll(/<script src="\.\/assets\/(app|control)\.([a-f0-9]{12})\.js"><\/script>/g)];assert.equal(refs.length,2);
  for(const r of refs){const source=fs.readFileSync(path.join(root,'assets',r[1]+'.js'));const built=fs.readFileSync(path.join(root,'assets',r[1]+'.'+r[2]+'.js'));assert.equal(crypto.createHash('sha256').update(source).digest('hex').slice(0,12),r[2]);assert.deepEqual(built,source);}
});
