import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const account=readFileSync(new URL('../../../assets/account.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../../../index.html',import.meta.url),'utf8');
const menu=html.match(/<script>\/\* Personal menu[\s\S]*?<\/script>/)[0].slice(8,-9);
const owner='0f75065b-2b26-4a87-bf26-005f5a2284d4';
function harness(){
 const window=new EventTarget(),document=new EventTarget(),data=new Map(),section={hidden:true};let calls=0;
 document.hidden=false;document.getElementById=()=>section;
 const context=vm.createContext({window,document,CustomEvent,localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)},fetch:()=>{calls++;throw Error('Unexpected network request')}});
 vm.runInContext(account,context);vm.runInContext(menu,context);
 const stored=id=>data.set('edpvz-auth-v1',JSON.stringify({access_token:'synthetic-test-session',user:{id}}));
 const storage=key=>window.dispatchEvent(Object.assign(new Event('storage'),{key}));
 return {window,document,data,section,stored,storage,get calls(){return calls}};
}
test('owner sign-in in iframe reveals private tiles in parent; logout hides them without network reads',()=>{
 const h=harness();assert.equal(h.section.hidden,true);h.stored(owner);h.storage('edpvz-auth-v1');assert.equal(h.section.hidden,false);assert.equal(h.window.EdPVZAccount.user.id,owner);
 h.data.delete('edpvz-auth-v1');h.storage('edpvz-auth-v1');assert.equal(h.section.hidden,true);assert.equal(h.window.EdPVZAccount.signedIn,false);assert.equal(h.calls,0);
});
test('resuming the PWA refreshes owner visibility while another account never sees private tiles',()=>{
 const h=harness();h.stored(owner);h.window.dispatchEvent(new Event('pageshow'));assert.equal(h.section.hidden,false);
 h.stored('another-user');h.window.dispatchEvent(new Event('focus'));assert.equal(h.section.hidden,true);
 h.stored(owner);h.document.dispatchEvent(new Event('visibilitychange'));assert.equal(h.section.hidden,false);
 h.data.clear();h.storage(null);assert.equal(h.section.hidden,true);
});
test('private entry remains near the top and cannot be hidden by general tile preferences',()=>{
 assert.ok(html.indexOf('id="private-disputes"')<html.indexOf('id="category-1"'));assert.match(html,/<b>Удержания и зависшие<\/b>/);
 assert.ok(html.includes(".filter(tile=>!tile.closest('#private-disputes'))"));
});
