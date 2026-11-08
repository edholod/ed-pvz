import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from '../server.mjs';
const token='test-only-'.repeat(6);
async function fixture(t,publish=false){
  const collector={feed:{updated:null,items:[]},controlUntil:0,status(){return {state:'authentication_required',count:this.feed.items.length}},async beginControl(){this.controlUntil=Date.now()+60000;return true},async finishControl(){this.controlUntil=0}};
  const server=createServer({collector,adminToken:token,publish,secure:false});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close()});
  return {collector,url:'http://127.0.0.1:'+server.address().port};
}
test('admin and browser endpoints reject unauthenticated access',async t=>{
  const {url}=await fixture(t);
  assert.equal((await fetch(url+'/admin/status')).status,401);
  assert.equal((await fetch(url+'/vnc/vnc.html')).status,403);
  assert.equal((await fetch(url+'/api/news')).status,403);
});
test('login requires same origin and correct secret',async t=>{
  const {url}=await fixture(t);const body=new URLSearchParams({token});
  assert.equal((await fetch(url+'/admin/login',{method:'POST',body})).status,403);
  assert.equal((await fetch(url+'/admin/login',{method:'POST',headers:{origin:url},body:new URLSearchParams({token:'wrong'})})).status,401);
  const response=await fetch(url+'/admin/login',{method:'POST',headers:{origin:url},body});
  assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  const cookie=response.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(url+'/admin/status',{headers:{cookie}})).status,200);
  assert.equal((await fetch(url+'/admin/logout',{method:'POST',headers:{origin:url,cookie}})).status,200);
  assert.equal((await fetch(url+'/admin/status',{headers:{cookie}})).status,401);
});
test('public API reports missing login and serves last successful cache after session expires',async t=>{
  const {url,collector}=await fixture(t,true);
  assert.equal((await fetch(url+'/api/news')).status,503);
  collector.feed.items=[{id:'synthetic',title:'Тест'}];
  const response=await fetch(url+'/api/news',{headers:{origin:'https://edholod.github.io'}});
  assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),'https://edholod.github.io');
  assert.equal((await response.json()).items[0].id,'synthetic');
});
test('VNC remains closed after admin login until explicit control is opened',async t=>{
  const {url}=await fixture(t);
  const response=await fetch(url+'/admin/login',{method:'POST',headers:{origin:url},body:new URLSearchParams({token})});
  const cookie=response.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(url+'/vnc/vnc.html',{headers:{cookie}})).status,403);
});
test('health is not presented as WB authentication success',async t=>{
  const {url}=await fixture(t);assert.equal((await fetch(url+'/healthz')).status,200);
  assert.equal((await (await fetch(url+'/api/status')).json()).state,'authentication_required');
});
test('weak admin configuration fails closed',()=>assert.throws(()=>createServer({collector:{},adminToken:'short'})));
test('manual screenshot and input are inaccessible before authentication',async t=>{
  const {url}=await fixture(t);assert.equal((await fetch(url+'/admin/screen')).status,401);
  assert.equal((await fetch(url+'/admin/input',{method:'POST',headers:{origin:url,'content-type':'application/json'},body:JSON.stringify({type:'text',text:'ed12'})})).status,401);
});
test('manual input remains blocked outside an explicitly opened control session',async t=>{
  const {url}=await fixture(t);const response=await fetch(url+'/admin/login',{method:'POST',headers:{origin:url},body:new URLSearchParams({token})});
  const cookie=response.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(url+'/admin/screen',{headers:{cookie}})).status,409);
  assert.equal((await fetch(url+'/admin/input',{method:'POST',headers:{origin:url,cookie,'content-type':'application/json'},body:JSON.stringify({type:'text',text:'ed12'})})).status,409);
});
