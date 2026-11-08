import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {scheduled} from '../scheduled.mjs';
import {encodeSession,encryptSession} from '../session.mjs';
async function fixture(t){const dir=await mkdtemp(path.join(tmpdir(),'ed-scheduled-'));t.after(()=>rm(dir,{recursive:true,force:true}));return {output:path.join(dir,'feed.json'),encrypted:path.join(dir,'session.enc')}}
test('unconfigured schedule reports missing session without launching a browser',async t=>{const options=await fixture(t);assert.equal(await scheduled({...options,secret:''}),'missing_session');assert.equal(JSON.parse(await readFile(options.output,'utf8')).items.length,0)});
test('invalid secret preserves previously collected news',async t=>{const options=await fixture(t);await writeFile(options.output,JSON.stringify({items:[{id:'retained'}]}));assert.equal(await scheduled({...options,secret:'invalid'}),'invalid_session');assert.equal(JSON.parse(await readFile(options.output,'utf8')).items[0].id,'retained')});
test('scheduled collector renews encrypted session and publishes only news',async t=>{
  const options=await fixture(t);const state={cookies:[{domain:'.wb.ru',name:'session',value:'synthetic-cookie'}],origins:[]};const secret=encodeSession(state);
  const page={goto:async()=>{},url:()=> 'https://my-pvz.wb.ru/news/owners',locator:()=>({first:()=>({waitFor:async()=>{}})}),getByText:()=>({count:async()=>0}),evaluate:async()=>[{title:'Тест',content:'Новость',dateText:'8 ноября 2026 г. в 10:00',links:[]}]};
  const chromium={launch:async()=>({newContext:async()=>({newPage:async()=>page,storageState:async()=>state}),close:async()=>{}})};
  assert.equal(await scheduled({...options,secret,chromium}),'ok');
  const output=await readFile(options.output,'utf8');assert.ok(!output.includes('synthetic-cookie'));assert.equal(JSON.parse(output).items.length,1);
  assert.ok(!(await readFile(options.encrypted,'utf8')).includes('synthetic-cookie'));
});
