import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Collector} from '../collector.mjs';
const card={title:'Тест',content:'Текст новости',dateText:'8 ноября 2026 г. в 10:00',links:[]};
test('automatic collection avoids heavy images but manual login retains images and script requests',async t=>{
 const keys=['SUPABASE_URL','EDPVZ_INGEST_TOKEN','WB_BROWSER_HEADFUL'];const before=Object.fromEntries(keys.map(key=>[key,process.env[key]]));keys.forEach(key=>delete process.env[key]);
 let policy,options;const page={url:()=> 'about:blank'};const context={pages:()=>[page],route:async(_pattern,fn)=>policy=fn,close:async()=>{}};
 const collector=new Collector('/unused',{launch:async(_dir,opts)=>{options=opts;return context}});
 t.after(async()=>{await collector.close();for(const key of keys)if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key]});
 await collector.start({paused:true});assert.equal(options.headless,true);
 collector.disputeRunning=true;let result;
 const request=kind=>({request:()=>({resourceType:()=>kind}),continue:async()=>result='continued',abort:async()=>result='aborted',fulfill:async data=>{assert.equal(data.contentType,'image/svg+xml');assert.ok(data.body.length<100);result='placeholder'}});
 await policy(request('image'));assert.equal(result,'placeholder');await policy(request('script'));assert.equal(result,'continued');await policy(request('media'));assert.equal(result,'aborted');
 collector.controlUntil=Date.now()+60000;await policy(request('image'));assert.equal(result,'continued');await policy(request('font'));assert.equal(result,'continued');
});
test('expired or blank WB page never overwrites the encrypted authenticated session',async()=>{
 const prior=process.env.EDPVZ_INGEST_TOKEN;process.env.EDPVZ_INGEST_TOKEN='synthetic-test-only-ingest-token';
 try{
  const collector=new Collector('/unused');collector.context={storageState:async()=>{throw Error('must not read expired session')}};
  for(const url of ['about:blank','https://my-pvz.wb.ru/login','https://my-pvz.wb.ru/auth']){collector.page={url:()=>url};await collector.backupSession()}
  collector.page={url:()=> 'https://my-pvz.wb.ru/pickpoints',getByTestId:()=>({count:async()=>0}),locator:()=>({innerText:async()=> 'Отправить код'})};await collector.backupSession();
 }finally{if(prior===undefined)delete process.env.EDPVZ_INGEST_TOKEN;else process.env.EDPVZ_INGEST_TOKEN=prior}
});
async function fixture(t){const directory=await mkdtemp(path.join(tmpdir(),'ed-collector-'));t.after(()=>rm(directory,{recursive:true,force:true}));let url='';const config={login:false,blocked:false,failEmployees:false,denied:false};
  const page={async goto(value){url=config.login?'https://my-pvz.wb.ru/login':value;if(config.failEmployees&&value.endsWith('employees'))throw Error('offline')},url:()=>url,locator:()=>({first:()=>({waitFor:async()=>{}})}),getByText:pattern=>({count:async()=>pattern.source.includes("Раздел")?(config.denied?1:0):(config.blocked?1:0)}),evaluate:async()=>[card]};
  const collector=new Collector(directory);collector.page=page;return {collector,config};}
test('both sections are collected and duplicate audiences merged',async t=>{const {collector}=await fixture(t);await collector.collect();assert.equal(collector.state,'ok');assert.equal(collector.feed.items.length,1);assert.deepEqual(collector.feed.items[0].audience,['owners','employees']);});
test('login expiry preserves cached news and reports reauthentication',async t=>{const {collector,config}=await fixture(t);await collector.collect();config.login=true;await collector.collect();assert.equal(collector.state,'authentication_required');assert.equal(collector.feed.items.length,1);});
test('one section failure preserves existing entries',async t=>{const {collector,config}=await fixture(t);await collector.collect();config.failEmployees=true;await collector.collect();assert.equal(collector.state,'partial');assert.equal(collector.feed.items.length,1);});
test('human verification blocks subsequent automatic attempts',async t=>{const {collector,config}=await fixture(t);config.blocked=true;await collector.collect();assert.equal(collector.state,'blocked');const before=collector.lastAttempt;await collector.collect();assert.equal(collector.lastAttempt,before);});
test('manual control pauses scheduled collection',async t=>{const {collector}=await fixture(t);collector.controlUntil=Date.now()+60000;await collector.collect();assert.equal(collector.lastAttempt,null);});
test('expired login stops scheduled retries until the owner finishes signing in',async t=>{
  const {collector,config}=await fixture(t);config.login=true;await collector.collect();
  const before=collector.lastAttempt;await collector.collect();assert.equal(collector.lastAttempt,before);
  config.login=false;await collector.finishControl();assert.equal(collector.state,'ok');
});

test("WB permission denial is distinguished from network failure and preserves cache",async t=>{const {collector,config}=await fixture(t);await collector.collect();config.denied=true;await collector.collect();assert.equal(collector.state,"access_denied");assert.equal(collector.sections.owners,"access_denied");assert.equal(collector.sections.employees,"access_denied");assert.equal(collector.feed.items.length,1);});

test('opening manual control preserves the existing WB page and organisation',async t=>{
  const {collector}=await fixture(t);await collector.collect();
  collector.page.goto=async()=>{throw Error('must not navigate')};
  assert.equal(await collector.beginControl(),true);assert.equal(collector.state,'manual_login');assert.equal(collector.status().controlOpen,true);
});
test('slow first WB navigation leaves manual control available instead of HTTP 500',async t=>{
  const {collector}=await fixture(t);
  collector.page.goto=async()=>{const error=Error('timeout');error.name='TimeoutError';throw error};
  collector.page.url=()=> 'about:blank';
  assert.equal(await collector.beginControl(),true);assert.equal(collector.status().controlOpen,true);
});

