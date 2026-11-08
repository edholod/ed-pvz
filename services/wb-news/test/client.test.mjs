import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../../apps/news/wb-news.js',import.meta.url),'utf8');
function create(fetcher){const context={module:{exports:{}},URL,AbortSignal};vm.runInNewContext(source,context);return context.module.exports.createLoader(fetcher)}
const ok=value=>({ok:true,json:async()=>value});
test('disabled connector honestly reports setup state and does not call the server',async()=>{
  let calls=0;const load=create(async()=>{calls++;return ok({enabled:false})});
  const data=await load();assert.equal(calls,1);assert.equal(data.items.length,0);assert.match(data.message,/ещё не подключён/);
});
test('connector loads approved WB entries without credentials',async()=>{
  let calls=0;const load=create(async(url,options)=>{assert.equal(options.credentials,'omit');return ok(++calls===1?{enabled:true,endpoint:'https://example.onrender.com'}:{items:[{title:'Тест',content:'Текст',origin:'my-pvz',url:'https://my-pvz.wb.ru/news/owners#ed-news-test'}],status:{state:'ok'}})});
  const data=await load();assert.equal(data.items.length,1);assert.match(data.message,/подключён/);
});
test('malformed or credential-bearing server URL cannot be used',async()=>{
  let calls=0;const load=create(async()=>{calls++;return ok({enabled:true,endpoint:'https://user:secret@example.com'})});
  assert.equal((await load()).items.length,0);assert.equal(calls,1);
});
test('expired login still shows cache with a clear reauthentication message',async()=>{
  let calls=0;const load=create(async()=>ok(++calls===1?{enabled:true,endpoint:'https://example.com'}:{items:[],status:{state:'authentication_required'}}));
  assert.match((await load()).message,/повторный вход/);
});
test('server outage returns no fake news and does not throw into the public feed',async()=>{
  const load=create(async()=>{throw Error('offline')});assert.equal((await load()).items.length,0);
});
test('GitHub Actions mode loads generated news without an external server',async()=>{
  let calls=0;const load=create(async(url)=>{if(++calls===1)return ok({enabled:true,mode:'github-actions'});assert.match(url,/raw\.githubusercontent\.com\/edholod\/ed-pvz\/main\/data\/wb-news\.json/);return ok({items:[],status:{state:'missing_session',intervalMinutes:30}})});
  assert.match((await load()).message,/требуется добавить/);assert.equal(calls,2);
});
