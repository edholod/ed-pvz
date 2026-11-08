import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Collector} from '../collector.mjs';
const card={title:'Тест',content:'Текст новости',dateText:'8 ноября 2026 г. в 10:00',links:[]};
async function fixture(t){const directory=await mkdtemp(path.join(tmpdir(),'ed-collector-'));t.after(()=>rm(directory,{recursive:true,force:true}));let url='';const config={login:false,blocked:false,failEmployees:false};
  const page={async goto(value){url=config.login?'https://my-pvz.wb.ru/login':value;if(config.failEmployees&&value.endsWith('employees'))throw Error('offline')},url:()=>url,locator:()=>({first:()=>({waitFor:async()=>{}})}),getByText:()=>({count:async()=>config.blocked?1:0}),evaluate:async()=>[card]};
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
