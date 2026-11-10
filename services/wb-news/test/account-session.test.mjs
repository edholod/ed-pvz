import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../../../assets/account.js',import.meta.url),'utf8');
function setup(fetcher,session){
 const data=new Map(session?[['edpvz-auth-v1',JSON.stringify(session)]]:[]),events={};
 const localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 const window={addEventListener:(n,fn)=>events[n]=fn,dispatchEvent(){}};
 vm.runInNewContext(source,{window,document:{addEventListener(){},hidden:false},localStorage,fetch:fetcher,CustomEvent:class{},Date,JSON,Error,encodeURIComponent});
 return {api:window.EdPVZAccount,data,events};
}
const reply=(status,data)=>({status,ok:status<300,text:async()=>JSON.stringify(data),json:async()=>data});
const old={access_token:'old',refresh_token:'refresh-old',expires_at:1,user:{id:'one'}};
const fresh={access_token:'new',refresh_token:'refresh-new',expires_at:9999999999,user:{id:'one'}};
test('existing email accounts and username accounts can sign in',async()=>{
 const bodies=[];const {api}=setup(async(url,opt)=>{bodies.push(JSON.parse(opt.body));return reply(200,fresh)});
 await api.signIn('Person@example.com','test');assert.equal(bodies[0].email,'person@example.com');
 await api.signIn('Staff_1','test');assert.equal(bodies[1].email,'staff_1@accounts.edpvz.invalid');
 await assert.rejects(api.signIn('invalid login','test'),/логин/);assert.equal(bodies.length,2);
});
test('network failure, rate limit and server error retain the local session for retry',async()=>{
 for(const status of [0,429,500,503]){
  const {api,data}=setup(async()=>{if(!status)throw Error('offline');return reply(status,{message:'temporary'})},old);
  await assert.rejects(api.ensure());assert.equal(api.signedIn,true);assert.ok(data.has('edpvz-auth-v1'));
 }
});
test('expired refresh credentials clear the session instead of retrying forever',async()=>{
 const {api,data}=setup(async()=>reply(400,{message:'Invalid refresh token'}),old);
 await assert.rejects(api.ensure());assert.equal(api.signedIn,false);assert.equal(data.has('edpvz-auth-v1'),false);
});
test('simultaneous API consumers share one refresh request',async()=>{
 let calls=0,finish;const gate=new Promise(r=>finish=r);
 const {api}=setup(async()=>{calls++;await gate;return reply(200,fresh)},old);
 const a=api.ensure(),b=api.ensure();finish();await Promise.all([a,b]);assert.equal(calls,1);assert.equal(api.user.id,'one');
});
test('a delayed refresh cannot restore a session after logout',async()=>{
 let finish;const gate=new Promise(r=>finish=r);
 const {api}=setup(async url=>{if(url.includes('refresh_token')){await gate;return reply(200,fresh)}return reply(200,{})},old);
 const pending=api.ensure();await api.signOut();finish();await pending;assert.equal(api.signedIn,false);
});
test('a failed refresh in one tab cannot clear a newer session saved by another tab',async()=>{
 let finish;const gate=new Promise(r=>finish=r);
 const {api,data}=setup(async()=>{await gate;return reply(400,{message:'stale token'})},old);
 const pending=api.ensure();data.set('edpvz-auth-v1',JSON.stringify(fresh));finish();await pending;
 assert.equal(api.signedIn,true);assert.equal(JSON.parse(data.get('edpvz-auth-v1')).refresh_token,'refresh-new');
});

test('point creation stores the selected marketplace and authenticated owner',async()=>{
 for(const market of ['wb','ozon','ym']){
  let body;const {api}=setup(async(url,opt)=>{body=JSON.parse(opt.body);return reply(200,[body])},fresh);
  await api.createPoint({point_id:'5000',name:'Point',market,owner_id:'forged'});
  assert.equal(body.market,market);assert.equal(body.owner_id,'one');
 }
 const {api}=setup(async()=>reply(200,[]),fresh);await assert.rejects(api.createPoint({point_id:'5000',market:'unknown'}),/маркетплейс/);
});
