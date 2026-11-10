import {syncConfigured,sessionEnvelope,ingest,saveScope} from './disputes-supabase.mjs';
import {encryptSession,decryptSession} from './session.mjs';
import {syncWBDisputes} from './disputes-browser.mjs';
import {randomUUID} from 'node:crypto';
import {hasWBCookies} from './disputes-model.mjs';
import {extractCards, normalizeCards, mergeNews, SECTIONS, WB_ORIGIN} from './news.mjs';
import {readFeed, saveFeed} from './storage.mjs';

export class Collector {
  constructor(directory, {launch, intervalMs = 900000} = {}) {
    this.directory = directory;
    this.launch = launch;
    this.intervalMs = intervalMs;
    this.state = 'starting';
    this.controlUntil = 0;
    this.feed = {updated: null, items: []};
    this.running = false;
    this.lastAttempt = null;
    this.sections = {};
    this.disputeInspection = {state:'not_checked',lastAttempt:null,sections:[]};
    this.disputeRunning = false;
    this.workerId=randomUUID();
  }
  async start({paused = false} = {}) {
    this.feed = await readFeed(this.directory);
    const launch = this.launch || (await import('playwright')).chromium.launchPersistentContext.bind((await import('playwright')).chromium);
    this.context = await launch(this.directory + '/browser', {
      headless: false, viewport: {width: 1280, height: 800},
      args: ['--disable-dev-shm-usage', '--renderer-process-limit=2', '--disable-gpu', '--disable-software-rasterizer', '--js-flags=--max-old-space-size=96'],
    });
    this.page = this.context.pages()[0] || await this.context.newPage();
    try {
      const backup=await sessionEnvelope('GET');
      if(backup.envelope){
        const state=decryptSession(backup.envelope,process.env.EDPVZ_INGEST_TOKEN);
        await this.context.addCookies(state.cookies);
        await this.context.addInitScript(({origins})=>{
          const matching=origins.find(x=>x.origin===location.origin);
          if(matching&&!sessionStorage.getItem('__edpvz_wb_restored')){
            for(const item of matching.localStorage||[])try{localStorage.setItem(item.name,item.value)}catch{}
            sessionStorage.setItem('__edpvz_wb_restored','1');
          }
        },{origins:state.origins});
        this.sessionRestored=true;
      }
    }catch(e){this.sessionRestored=false;console.error('encrypted_session_restore_failed',String(e.message||'error').slice(0,70))}
    this.timer = setInterval(() => this.collect(), this.intervalMs);
    // Poll the persistent due time/request queue; an active run is leased across restarts.
    this.disputeTimer = setInterval(() => this.inspectDisputes().catch(()=>{}), 60000);
    this.disputeTimer.unref?.();
    if (paused) this.state = 'authentication_required';
    else await this.collect();
    await this.inspectDisputes();
  }
  status() {
    return {state: this.state, updated: this.feed.updated, count: this.feed.items.length,
      lastAttempt: this.lastAttempt, sections: this.sections,
      controlOpen: this.controlUntil > Date.now(), intervalMinutes: this.intervalMs / 60000,
      disputeInspection:this.disputeInspection,
      disputeSyncConfigured:syncConfigured()};
  }
  async beginControl() {
    if (this.running || this.disputeRunning) return false;
    this.controlUntil = Date.now() + 15 * 60000;
    // Keep the selected organisation and any in-progress sign-in intact.
    // A slow WB document must not turn an otherwise opened control lease into HTTP 500.
    if (new URL(this.page.url()).origin !== WB_ORIGIN) {
      try {
        await this.page.goto(WB_ORIGIN + '/news/owners', {waitUntil: 'domcontentloaded', timeout: 45000});
      } catch (error) {
        if (error.name !== 'TimeoutError') { this.controlUntil = 0; throw error; }
      }
    }
    this.state = 'manual_login';
    return true;
  }
  async finishControl() {
    this.controlUntil = 0;
    // A successful manual login leaves state=manual_login. News access is not proof of WB authentication.
    this.state = 'starting';
    await this.backupSession().catch(()=>{});
    await this.collect();
    await this.inspectDisputes({force:true});
  }
  async backupSession(){
    if(!this.context||!process.env.EDPVZ_INGEST_TOKEN)return;
    if(this.page){
      const url=new URL(this.page.url());
      if(url.origin!=='https://my-pvz.wb.ru'||/\/(login|auth|signin)(\/|$)/i.test(url.pathname))return;
      if(typeof this.page.getByTestId==='function'&&!await this.page.getByTestId('app-header').count()&&!/Выберите организацию/.test(await this.page.locator('body').innerText()))return;
    }
    const state=await this.context.storageState();
    if(!hasWBCookies(state)&&!state.origins?.some(x=>/^https:\/\/([\w-]+\.)*(wb|wildberries)\.ru$/.test(x.origin)&&x.localStorage?.length))return;
    await sessionEnvelope('POST',encryptSession(state,process.env.EDPVZ_INGEST_TOKEN));
  }
  async collect() {
    if (this.running || this.disputeRunning || this.controlUntil > Date.now() || this.state === 'blocked' || this.state === 'authentication_required') return;
    this.running = true;
    this.lastAttempt = new Date().toISOString();
    let received = [];
    let successes = 0;
    try {
      for (const section of SECTIONS) {
        try {
          await this.page.goto(`${WB_ORIGIN}/news/${section}`, {waitUntil: 'domcontentloaded', timeout: 45000});
          await this.page.locator('h1, input, iframe').first().waitFor({state: 'attached', timeout: 20000}).catch(() => {});
          const current = new URL(this.page.url());
          if (current.origin !== WB_ORIGIN || /\/(login|auth|signin)(\/|$)/i.test(current.pathname)) {
            this.sections[section] = 'authentication_required';
            this.state = 'authentication_required';
            break;
          }
          // Detect rendered safeguards; never evade them or retry around a block.
          const block = await this.page.getByText(/verify you are human|checking your browser|unusual traffic|automated traffic|подтвердите.{0,30}(человек|робот)/i).count();
          if (block) { this.state = 'blocked'; this.sections[section] = 'blocked'; break; }
          if (await this.page.getByText(/^Раздел недоступен$/i).count()) {
            this.sections[section] = 'access_denied';
            continue;
          }
          await this.page.locator('h1').first().waitFor({state: 'attached', timeout: 20000});
          const cards = normalizeCards(await this.page.evaluate(extractCards), section);
          if (!cards.length) { this.sections[section] = 'layout_changed'; continue; }
          received.push(...cards);
          this.sections[section] = 'ok';
          successes++;
        } catch {
          this.sections[section] = 'unavailable';
        }
      }
      if (received.length) {
        const next = {updated: new Date().toISOString(), items: mergeNews(this.feed.items, received)};
        await saveFeed(this.directory, next);
        this.feed = next;
      }
      if (this.state !== 'blocked' && this.state !== 'authentication_required') {
        this.state = successes === 2 ? 'ok' : successes ? 'partial' : Object.values(this.sections).includes('access_denied') ? 'access_denied' : 'unavailable';
      }
      if (successes === 2) this.state = 'ok';
      if (successes>0) try{await this.backupSession()}catch(e){console.error('encrypted_session_backup_failed',String(e.message||'error').slice(0,70))}
    } finally { this.running = false; }
  }
  async inspectDisputes({force=false}={}) {
    if(this.running||this.disputeRunning||this.controlUntil>Date.now()||!this.page||!syncConfigured())return;
    this.disputeRunning=true;
    let claim,heartbeat;
    try{
      claim=await ingest({kind:'claim',worker:this.workerId,force});
      if(!claim.claimed){
        if(this.disputeInspection.state==='not_checked')this.disputeInspection={state:claim.state,lastAttempt:null,sections:[]};
        return;
      }
      const lease={worker:this.workerId,run_id:claim.run_id};
      this.disputeInspection={state:'running',lastAttempt:new Date().toISOString(),sections:[],rows:0,tickets:0};
      let heartbeatBusy=false;
      heartbeat=setInterval(async()=>{
        if(heartbeatBusy)return;heartbeatBusy=true;
        try{await ingest({kind:'heartbeat',...lease,report:this.disputeInspection})}
        catch{console.error('disputes_heartbeat_failed')}
        finally{heartbeatBusy=false}
      },30000);heartbeat.unref?.();
      const config=await ingest();
      if(!config.registry?.length)throw Error('registry_not_configured');
      await this.backupSession().catch(()=>{});
      const result=await syncWBDisputes(this.page,{
        registry:config.registry,tickets:config.tickets||[],
        saveScope:batch=>saveScope(batch,lease),
        onProgress:report=>{this.disputeInspection={...report,lastAttempt:report.started_at}}
      });
      this.disputeInspection={...result,lastAttempt:result.started_at};
      await ingest({kind:'finish',...lease,state:result.state,report:result});
      if(['ok','partial'].includes(result.state))await this.backupSession().catch(()=>{});
    }catch(e){
      const state=e.code||'unavailable';
      this.disputeInspection={...this.disputeInspection,state,error:state,...(e.diagnostic?{diagnostic:e.diagnostic}:{})};
      if(claim?.claimed)await ingest({kind:'finish',worker:this.workerId,run_id:claim.run_id,state,report:this.disputeInspection,error:state}).catch(()=>{});
      // Do not keep a heavy WB login application running while waiting for the owner.
      if(state==='authentication_required'&&this.controlUntil<=Date.now())await this.page.goto('about:blank',{waitUntil:'domcontentloaded',timeout:10000}).catch(()=>{});
    }finally{clearInterval(heartbeat);this.disputeRunning=false;}
  }
  async close() {
    clearInterval(this.timer);
    clearInterval(this.disputeTimer);
    await this.context?.close();
  }
}

