import {readFile, writeFile, mkdir, mkdtemp, rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {decodeSession, encryptSession, decryptSession} from './session.mjs';
import {Collector} from './collector.mjs';
import {createHash} from 'node:crypto';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const OUTPUT=path.join(ROOT,'data/wb-news.json');
const ENCRYPTED=path.join(ROOT,'data/wb-session.enc');
export async function scheduled({secret=process.env.WB_SESSION, chromium, output=OUTPUT, encrypted=ENCRYPTED}={}){
  let previous={updated:null,items:[]};
  try{const data=JSON.parse(await readFile(output,'utf8'));if(Array.isArray(data.items))previous=data}catch{}
  const revision=secret?createHash('sha256').update(secret.trim()).digest('hex').slice(0,24):null;
  const persist=async(status,feed=previous)=>{if(feed===previous&&previous.status?.state===status&&previous.status?.sessionRevision===revision)return status;await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify({...feed,source:'my-pvz',status:{state:status,sessionRevision:revision,checked:new Date().toISOString(),intervalMinutes:30}},null,2));return status};
  if(!secret)return persist('missing_session');
  if(['blocked','authentication_required'].includes(previous.status?.state)&&previous.status?.sessionRevision===revision)return previous.status.state;
  let state;
  try{state=decodeSession(secret)}catch{return persist('invalid_session')}
  try{state=decryptSession(await readFile(encrypted,'utf8'),secret)}catch{}
  const scratch=await mkdtemp(path.join(tmpdir(),'ed-wb-fetch-'));
  let browser;
  try{
    chromium=chromium||(await import('playwright')).chromium;
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext({storageState:state,viewport:{width:1280,height:800}});
    const collector=new Collector(scratch);collector.context=context;collector.page=await context.newPage();collector.feed=previous;
    await collector.collect();
    if(['ok','partial'].includes(collector.state)){
      const renewed=await context.storageState();
      await writeFile(encrypted,encryptSession(renewed,secret),{mode:0o600});
    }
    return persist(collector.state,collector.feed);
  }catch{return persist('unavailable')}
  finally{await browser?.close();await rm(scratch,{recursive:true,force:true})}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const state=await scheduled();console.log('WB collection state:',state);
  if(['unavailable','blocked','invalid_session','authentication_required'].includes(state))process.exitCode=2;
}
