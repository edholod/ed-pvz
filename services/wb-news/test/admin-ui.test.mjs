import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
function fixture(){
 const elements=new Map(),timers=[];const node=id=>{if(!elements.has(id))elements.set(id,{hidden:id==='controls',value:'',textContent:'',dataset:{}});return elements.get(id)};
 let status=200,networkError=false;
 const context=vm.createContext({document:{getElementById:node},AbortSignal,URLSearchParams,setTimeout,setInterval:fn=>timers.push(fn),fetch:async()=>{if(networkError)throw Error('offline');return {ok:status===200,status,json:async()=>status===200?{state:'starting',count:0}:{error:'authentication_required'}}}});
 vm.runInContext(source,context);
 return {node,context,setStatus:s=>status=s,setOffline:s=>networkError=s,refresh:()=>vm.runInContext('refresh()',context)};
}
test('10-second status polling keeps controls through a network outage and server error, then recovers',async()=>{
 const f=fixture();await new Promise(r=>setImmediate(r));assert.equal(f.node('controls').hidden,false);
 f.setOffline(true);await f.refresh();assert.equal(f.node('controls').hidden,false);assert.equal(f.node('login').hidden,true);assert.match(f.node('message').textContent,/Повторяем/);
 f.setOffline(false);f.setStatus(503);await f.refresh();assert.equal(f.node('controls').hidden,false);
 f.setStatus(200);await f.refresh();assert.equal(f.node('message').textContent,'');
});
test('only an explicit unauthorized response returns the token form',async()=>{
 const f=fixture();await new Promise(r=>setImmediate(r));f.setStatus(401);await f.refresh();assert.equal(f.node('controls').hidden,true);assert.equal(f.node('login').hidden,false);
});
