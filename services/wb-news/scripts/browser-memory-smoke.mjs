import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {Collector} from '../collector.mjs';
import {renewWBPage} from '../browser-memory.mjs';
const directory=await mkdtemp(tmpdir()+'/edpvz-tab-smoke-');let context;
try{
 context=await chromium.launchPersistentContext(directory,{headless:true,viewport:{width:1280,height:800},args:['--disable-dev-shm-usage','--no-sandbox','--renderer-process-limit=1']});
 await context.route('https://wb-session-test.invalid/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Local synthetic session fixture</title><p>Fixture</p>'}));
 let page=context.pages()[0]||await context.newPage();
 // Initial restore belongs to the first page, not every future renderer.
 await page.addInitScript(()=>{if(!sessionStorage.getItem('restored')){localStorage.setItem('fixture','initial');sessionStorage.setItem('restored','1')}});
 await page.goto('https://wb-session-test.invalid/');
 await page.evaluate(()=>{localStorage.setItem('fixture','current');document.cookie='fixture=preserved; Secure; SameSite=Strict'});
 for(let pass=0;pass<3;pass++){
  page=await renewWBPage(page);await page.goto('https://wb-session-test.invalid/');
  assert.deepEqual(await page.evaluate(()=>({storage:localStorage.getItem('fixture'),cookie:document.cookie})),{storage:'current',cookie:'fixture=preserved'});
  assert.equal(context.pages().length,1);
 }
 console.log('Browser tab recycling: cookies and current origin storage preserved; stale initial restore not replayed.');
}finally{await context?.close();await rm(directory,{recursive:true,force:true})}

const fullDirectory=await mkdtemp(tmpdir()+'/edpvz-full-smoke-');const worker=new Collector(fullDirectory);
try{
 await worker.openBrowser();
 const configure=()=>worker.context.route('https://wb-session-test.invalid/**',route=>route.fulfill({contentType:'text/html',body:'<p>Full restart fixture</p>'}));
 await configure();await worker.page.goto('https://wb-session-test.invalid/');
 await worker.page.evaluate(()=>{localStorage.setItem('fixture','current');document.cookie='fixture=preserved; Secure; SameSite=Strict'});
 for(let i=0;i<2;i++){
  const previous=worker.context;await worker.restartBrowser();assert.notEqual(worker.context,previous);await configure();await worker.page.goto('https://wb-session-test.invalid/');
  assert.deepEqual(await worker.page.evaluate(()=>({storage:localStorage.getItem('fixture'),cookie:document.cookie})),{storage:'current',cookie:'fixture=preserved'});
 }
 console.log('Full browser restarts preserve current cookies and origin storage.');
}finally{await worker.close();await rm(fullDirectory,{recursive:true,force:true})}
