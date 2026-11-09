import {inspectWBDisputePages} from './disputes-inspector.mjs';
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
  }
  async start({paused = false} = {}) {
    this.feed = await readFeed(this.directory);
    const launch = this.launch || (await import('playwright')).chromium.launchPersistentContext.bind((await import('playwright')).chromium);
    this.context = await launch(this.directory + '/browser', {
      headless: false, viewport: {width: 960, height: 640},
      args: ['--disable-dev-shm-usage', '--renderer-process-limit=2'],
    });
    this.page = this.context.pages()[0] || await this.context.newPage();
    this.timer = setInterval(() => this.collect(), this.intervalMs);
    this.disputeTimer = setInterval(() => this.inspectDisputes(), 3 * 60 * 60 * 1000);
    this.disputeTimer.unref?.();
    if (paused) this.state = 'authentication_required';
    else await this.collect();
  }
  status() {
    return {state: this.state, updated: this.feed.updated, count: this.feed.items.length,
      lastAttempt: this.lastAttempt, sections: this.sections,
      controlOpen: this.controlUntil > Date.now(), intervalMinutes: this.intervalMs / 60000,
      disputeInspection:this.disputeInspection};
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
    if (this.state === 'blocked' || this.state === 'authentication_required') this.state = 'starting';
    return this.collect();
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
          if (current.origin !== WB_ORIGIN || current.pathname.includes('login')) {
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
    } finally { this.running = false; }
  }
  async inspectDisputes() {
    if (this.running || this.disputeRunning || this.controlUntil>Date.now() || !this.page || !['ok','partial'].includes(this.state)) return;
    this.disputeRunning=true;
    const lastAttempt=new Date().toISOString();
    try {
      const sections=await inspectWBDisputePages(this.page);
      this.disputeInspection={lastAttempt,sections,state:sections.some(x=>x.state==='blocked')?'blocked':sections.some(x=>x.state==='authentication_required')?'authentication_required':'inspection_only'};
    } catch {this.disputeInspection={lastAttempt,sections:[],state:'unavailable'};}
    finally {this.disputeRunning=false;}
  }
  async close() {
    clearInterval(this.timer);
    clearInterval(this.disputeTimer);
    await this.context?.close();
  }
}
