import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {makeBackup,validateBackup,restoreBackup,inspectBackup} from '../../../apps/transfer/storage.mjs';
class MemoryStorage{
 constructor(entries=[]){this.data=new Map(entries)}
 get length(){return this.data.size}
 key(i){return [...this.data.keys()][i]??null}
 getItem(key){return this.data.get(key)??null}
 setItem(key,value){this.data.set(key,String(value))}
 removeItem(key){this.data.delete(key)}
}
test('local transfer exports application records and excludes credentials and unrelated sites',()=>{
 const source=new MemoryStorage([['edpvz-ui-settings-v1','{"theme":"pink"}'],['pvz-control-v1','{"points":[]}'],['edpvz-auth-v1','SECRET'],['edpvz-local-lock-v1','PIN'],['other-site','PRIVATE']]);
 const backup=makeBackup(source,'https://edholod.github.io');
 assert.deepEqual(backup.entries.map(row=>row.key),['edpvz-ui-settings-v1','pvz-control-v1']);
 assert.ok(!JSON.stringify(backup).includes('SECRET'));assert.ok(!JSON.stringify(backup).includes('PIN'));
 const target=new MemoryStorage([['edpvz-ui-settings-v1','existing']]);
 assert.equal(inspectBackup(target,backup)[0].state,'conflict');
 assert.deepEqual(restoreBackup(target,backup),{added:1,conflicts:1});
 assert.equal(target.getItem('edpvz-ui-settings-v1'),'existing');
 assert.equal(target.getItem('pvz-control-v1'),'{"points":[]}');
 assert.deepEqual(restoreBackup(target,backup),{added:0,conflicts:1});
});
test('local transfer rejects injected credentials, malformed records and duplicate keys',()=>{
 const base={format:'edpvz-local-transfer',version:1};
 for(const entries of [[{key:'edpvz-auth-v1',value:'token'}],[{key:'pvz-control-v1',value:{}}],[{key:'pvz-control-v1',value:'a'},{key:'pvz-control-v1',value:'b'}]]){
  assert.throws(()=>validateBackup({...base,entries}));
 }
 assert.throws(()=>validateBackup({...base,version:2,entries:[]}));
});
test('storage quota failure rolls back newly written records and preserves existing data',()=>{
 const target=new MemoryStorage([['edpvz-ui-settings-v1','keep']]);
 target.setItem=function(key,value){if(key==='edpvz-salary-v1')throw Error('QuotaExceeded');this.data.set(key,value)};
 const backup=makeBackup(new MemoryStorage([['edpvz-management-v1','a'],['edpvz-salary-v1','b']]),'https://edholod.github.io');
 assert.throws(()=>restoreBackup(target,backup),/свободное место/);
 assert.deepEqual([...target.data],[['edpvz-ui-settings-v1','keep']]);
});
test('notification navigation follows the installation scope on both addresses',async()=>{
 const code=await readFile(new URL('../../../sw.js',import.meta.url),'utf8');
 for(const scope of ['https://edholod.github.io/ed-pvz/','https://edpvz.ru/']){
  const handlers={},opened=[],notifications=[];
  const self={location:new URL(scope),registration:{scope,showNotification:async(title,options)=>notifications.push(options)},addEventListener:(name,handler)=>handlers[name]=handler,clients:{matchAll:async()=>[],openWindow:async url=>opened.push(url)}};
  vm.runInNewContext(code,{self,URL});
  const event={waitUntil(p){this.promise=p},notification:{close(){}},data:{json:()=>({})}};
  handlers.push(event);await event.promise;
  handlers.notificationclick(event);await event.promise;
  const target=new URL('apps/account/#notifications',scope).href;
  assert.equal(notifications[0].data.url,target);assert.deepEqual(opened,[target]);
 }
});
