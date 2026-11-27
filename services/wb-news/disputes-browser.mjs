import {selectOrganization,readOrganizationEvidence,verifyOrganization,organizationLabelMatches} from './disputes-organizations.mjs';
import {eligibleObservation,observationRows,normalizeMessages,ticketNeedsDetail,localDate} from './disputes-model.mjs';
const ORIGIN='https://my-pvz.wb.ru';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const stamp=()=>new Date().toISOString();
export class WBReadError extends Error{constructor(code){super(code);this.code=code}}
export async function pageReady(page,heading){
 await page.waitForFunction(({heading})=>{
  const text=document.body?.innerText||'';
  return text.split('\n').some(line=>line.trim()===heading)||
   /Отправить код|Войти по|Раздел недоступен|verify you are human|checking your browser/i.test(text);
 },{heading},{timeout:35000}).catch(()=>{});
 const info=await page.evaluate(()=>({url:location.href,text:document.body?.innerText||'',headings:[...document.querySelectorAll('h1,h2')].map(x=>x.textContent.trim())}));
 if(/verify you are human|checking your browser|unusual traffic|automated traffic|подтвердите.{0,30}(человек|робот)/i.test(info.text))throw new WBReadError('blocked');
 if(new URL(info.url).origin!==ORIGIN||/\/(login|auth|signin)(\/|$)/i.test(new URL(info.url).pathname)||/Отправить код/.test(info.text))throw new WBReadError('authentication_required');
 if(/Раздел недоступен/.test(info.text))throw new WBReadError('access_denied');
 if(!info.headings.includes(heading)&&!info.text.split('\n').some(line=>line.trim()===heading))throw new WBReadError(info.headings.includes('ПВЗ')?'role_restricted':'layout_changed');
 return info;
}
export async function releaseBrowserMemory(page){
 // Long WB scans run on a 512 MiB worker. Ask Chromium to release caches and
 // collect unused memory between documents; never clear cookies or localStorage.
 let session;
 try{session=await page.context().newCDPSession(page);await session.send('Memory.simulatePressureNotification',{level:'critical'})}
 catch{/* Optional Chromium housekeeping must never interrupt source reading. */}
 finally{await session?.detach().catch(()=>{})}
}
async function navigate(page,url,heading,org){
 await releaseBrowserMemory(page);
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
 await pageReady(page,heading);
 if(new URL(page.url()).pathname.replace(/\/$/,'')!==new URL(url).pathname.replace(/\/$/,''))throw new WBReadError('role_restricted');
 // WB may display only the active PVZ in its header. Selection is verified
 // separately; absence of the legal name here is not evidence of mismatch.
}
export {selectOrganization} from './disputes-organizations.mjs';

async function closeTopDrawer(page){
 const dialogs=page.getByRole('dialog');if(!await dialogs.count())return false;
 const dialog=dialogs.last(),handle=await dialog.elementHandle();if(!handle)return false;
 try{await dialog.getByRole('button').first().click({timeout:5000});await handle.waitForElementState('hidden',{timeout:5000})}
 finally{await handle.dispose()}
 return true;
}
async function closeDrawers(page){for(let i=0;i<4;i++)if(!await closeTopDrawer(page))break}
export async function scanVirtual(page,root,extract,{maxWindows=150,bottomQuietMs=2500,settleUnlisted=false,wait=sleep,now=Date.now,enrich=null}={}){
 const found=new Map();let bottomPasses=0,lastSize=0,stalledPasses=0,lastMetrics=null,quietSince=null;
 const scroller=root.getByTestId('virtuoso-scroller').filter({visible:true}).last();
 const has=await scroller.count();
 if(has)await scroller.evaluate(e=>{e.scrollTop=0});
 for(let window=0;window<maxWindows;window++){
  await wait(180);
  const rows=await root.evaluate(extract);
  if(!has&&settleUnlisted){
   const signature=JSON.stringify(rows);
   if(signature!==lastMetrics){lastMetrics=signature;quietSince=now()}
   if(now()-quietSince>=bottomQuietMs)return {rows,complete:true};
   continue;
  }
  for(const [index,row] of rows.entries()){
   const key=row.position??(row.point&&!row.number?'point:'+row.point:JSON.stringify([row.barcode,row.number,row.groupLabel,row.text,index]));
   const previous=found.get(key);
   const extra=previous || (enrich ? await enrich(row) : null);
   found.set(key,{...row,...(extra?.dateLocal&&!row.dateLocal?{dateLocal:extra.dateLocal}:{}),
    ...(extra?.movement?.length?{movement:extra.movement}:{}),
    ...(extra?.productUrl&&!row.productUrl?{productUrl:extra.productUrl}:{})});
  }
  if(!has)return {rows:[...found.values()],complete:true};
  const metrics=await scroller.evaluate(e=>({top:e.scrollTop,height:e.clientHeight,total:e.scrollHeight,busy:[...e.querySelectorAll('[role="progressbar"],[aria-busy="true"]')].some(el=>el.getClientRects().length>0)}));
  const bottom=metrics.top+metrics.height>=metrics.total-3;
  if(bottom&&found.size===lastSize)bottomPasses++;else bottomPasses=0;
  if(!bottom||metrics.busy||found.size!==lastSize)quietSince=null;else if(quietSince===null)quietSince=now();
  if(bottomPasses>=3&&quietSince!==null&&now()-quietSince>=bottomQuietMs)return {rows:[...found.values()],complete:true};
  const signature=JSON.stringify(metrics);
  stalledPasses=!bottom&&!metrics.busy&&signature===lastMetrics&&found.size===lastSize?stalledPasses+1:0;
  if(stalledPasses>=4)return {rows:[...found.values()],complete:false,reason:'stalled_scroller'};
  lastMetrics=signature;lastSize=found.size;
  await scroller.evaluate(e=>{e.scrollTop=Math.min(e.scrollTop+Math.max(120,e.clientHeight*.75),e.scrollHeight)});
 }
 return {rows:[...found.values()],complete:false};
}
export function extractGoods(root){
 const out=[];
 for(const button of root.querySelectorAll('button')){
  const m=(button.innerText||'').match(/^ШК\s*(\d{4,40})$/);if(!m)continue;
  let card=button.parentElement,chosen=null;
  for(let n=0;card&&n<9;n++,card=card.parentElement){
   const text=card.innerText||'';
   if((text.match(/ШК\s*\d{4,40}/g)||[]).length!==1)break;
   if(text.includes('₽')&&card.querySelector('img')){chosen=card;break}
  }
  if(!chosen)continue;
  const lines=chosen.innerText.split('\n').map(x=>x.trim()).filter(Boolean),img=chosen.querySelector('img');
  const title=img?.alt&&img.alt!=='product image'?img.alt:lines[lines.findIndex(x=>/^ШК/.test(x))+1];
  const amount=lines.findLast(x=>/^-?[\d\s.,\u00a0]+\s*₽$/.test(x));
  let ticket=chosen.innerText.match(/(?:тикет|обращение)\s*№?\s*(\d{3,})/i);
  // WB can put the appeal deadline in a sibling footer outside the price block.
  // Stay inside this virtual row and never borrow a neighbouring product's date.
  const boundary=chosen.closest('[data-index],[data-item-index]');
  let dateLabel='',withholdLabel='',productUrl=null;
  for(let node=chosen,depth=0;node&&depth<9;node=node.parentElement,depth++){
   const text=node.innerText||'';
   if((text.match(/ШК\s*\d{4,40}/g)||[]).length!==1)break;
   productUrl ||= [...node.querySelectorAll('a[href]')].map(link=>link.href)
    .find(url=>/^https:\/\/(?:www\.)?wildberries\.ru\/catalog\/\d+\/detail\.aspx(?:[?#]|$)/i.test(url)) || null;
   if(!ticket&&/В тикет|К тикету|К обращению/i.test(text)){const refs=[...node.querySelectorAll('button,a')].map(el=>(el.innerText||'').trim().match(/^№\s*(\d{3,})$/)).filter(Boolean);if(refs.length===1)ticket=refs[0]}
   const dates=text.split('\n').map(x=>x.trim()).filter(x=>/^(?:(?:Оспорить|Срок (?:обращения|оспаривания))\s+)?до\s+\d{2}\.\d{2}\.\d{4}(?:,?\s+\d{2}:\d{2})?$/i.test(x));
   const unique=[...new Set(dates.map(x=>x.replace(/^.*?до\s+/i,'до ')))];
   if(unique.length===1&&!dateLabel)dateLabel=unique[0];
   const scheduled=text.match(/Будет удержано\s+\d{2}\.\d{2}\.\d{4}(?:,? *\d{2}:\d{2})?/i);
   if(scheduled&&!withholdLabel)withholdLabel=scheduled[0].replace(/\s+/g,' ');
   if(unique.length>1||node===boundary||node===root)break;
  }
  const start=lines.indexOf(title),end=lines.findIndex(x=>/^(В тикет|Оспорить)$/.test(x));
  const reason=lines.slice(start+1,end>=0?end:undefined).filter(x=>x!==amount&&x!==dateLabel).join('\n');
  const wrapper=chosen.closest('[data-index],[data-item-index]');
  let eventId=null;
  for(const el of [chosen,button])for(const key of ['eventId','recordId','defectId','hangingId'])if(el.dataset?.[key])eventId=el.dataset[key];
  out.push({barcode:m[1],title,photo:img?.getAttribute('src'),amount,reason,dateLabel,withholdLabel,ticketNumber:ticket?.[1]||null,eventId,productUrl,
    position:wrapper?.getAttribute('data-index')??wrapper?.getAttribute('data-item-index')??null});
 }
 return out;
}
export function extractPointGroups(root){
 const result=[];
 for(const p of root.querySelectorAll('p')){
  const m=p.innerText.trim().match(/^ID\s+(\d{4,12})$/);if(!m)continue;
  let card=p.parentElement;
  for(let n=0;card&&n<5;n++,card=card.parentElement){
   const text=card.innerText||'';
   if((text.match(/\bID\s+\d+/g)||[]).length>1)break;
   if(/Товаров\s*\d+/.test(text)){
    result.push({point:m[1],address:p.nextElementSibling?.innerText||'',count:Number(text.match(/Товаров\s*(\d+)/)?.[1]),text});break;
   }
  }
 }
 return result;
}
export function extractHangingGroupLabels(root){
 return [...new Set([...root.querySelectorAll('*')].map(el=>(el.innerText||el.textContent||'').replace(/\s+/gu,' ').trim()).filter(text=>/^Товары из ПВЗ$|^№\s*\d+$/.test(text)))];
}
export function extractHangingGroups(root){
 const labels=[...new Set([...root.querySelectorAll('*')].map(el=>(el.innerText||el.textContent||'').replace(/\s+/gu,' ').trim()).filter(text=>/^Товары из ПВЗ$|^№\s*\d+$/.test(text)))];
 return labels.map(label=>({label,position:'group:'+label}));
}
export async function revealVirtualText(root,text,{wait=sleep,maxWindows=150}={}){
 const target=root.getByText(text,{exact:true}).filter({visible:true}).first();if(await target.count())return target;
 const scroller=root.getByTestId('virtuoso-scroller').filter({visible:true}).last();
 if(!await scroller.count()){
  try{await target.waitFor({state:'visible',timeout:2000});return target}catch{return null}
 }
 await scroller.evaluate(e=>{e.scrollTop=0});
 for(let n=0;n<maxWindows;n++){
  await wait(180);if(await target.count())return target;
  const bottom=await scroller.evaluate(e=>e.scrollTop+e.clientHeight>=e.scrollHeight-3);
  if(bottom){
   try{await target.waitFor({state:'visible',timeout:1200});return target}catch{return null}
  }
  await scroller.evaluate(e=>{e.scrollTop+=Math.max(120,e.clientHeight*.75)});
 }return null;
}
export function readGoodsScopeProof(root){
 const text=root.innerText||root.textContent||'';
 const declared=text.match(/(?:^|\n)\s*(\d+)\s*ПВЗ\s*(?:\n|$)/);
 const pointSelect=[...root.querySelectorAll('[aria-expanded]')].find(el=>(el.innerText||el.textContent||'').trim()==='Адрес или ID ПВЗ');
 return {header:root.querySelector('[data-testid="app-header"]')?.innerText||'',declaredPoints:declared?Number(declared[1]):null,noGoods:/Нет товаров/i.test(text),pointFilterEmpty:Boolean(pointSelect&&pointSelect.getAttribute('aria-expanded')==='false'),inputsEmpty:[...root.querySelectorAll('input')].every(el=>!String(el.value||'').trim()),periodPresent:text.split('\n').some(line=>line.trim()==='Период')};
}
export function confirmsAbsentPoints(proof,groupScan,org){
 const allowed=new Set(org.points.map(point=>point.wb_point_id)),ids=new Set(groupScan.rows.map(group=>group.point));
 return groupScan.complete&&organizationLabelMatches(proof.header,org.name_exact)&&proof.pointFilterEmpty&&proof.inputsEmpty&&proof.periodPresent&&[...ids].every(id=>allowed.has(id))&&(proof.declaredPoints===ids.size||(proof.noGoods&&ids.size===0));
}
export async function expandVisibleReasons(root){
 const matches=root.getByText('Развернуть',{exact:true});
 for(let attempt=0;attempt<30;attempt++){
  const count=await matches.count();let target;
  for(let i=0;i<count;i++)if(await matches.nth(i).isVisible()){target=matches.nth(i);break}
  if(!target)return true;
  try{await target.click({timeout:2000})}catch{return false}
  await sleep(100);
  // Do not repeatedly toggle/retry a control which did not change after its click.
  if(await matches.count()>=count)return false;
 }return false;
}
export async function waitGoodsDrawer(page,{groups=false}={}){
 await page.waitForFunction(({groups})=>{
  const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(el=>!el.getClientRects||el.getClientRects().length);
  const text=dialogs.at(-1)?.innerText||'';
  return /ШК\s*\d{4,40}|Нет товаров|Раздел недоступен/.test(text)||(groups&&/Товары из ПВЗ|№\s*\d+/.test(text));
 },{groups},{timeout:25000});
}
export function movementEvents(text){
 const events=[];
 const date=/^(\d{1,2}\s+[а-яё]+\s+\d{4}\s*г\.?)\s*[•·]?\s*(\d{1,2}:\d{2})\s*(.*)$/iu;
 const lines=String(text||'').split('\n').map(line=>line.trim()).filter(Boolean);
 for(let i=0;i<lines.length;i++){
  const same=lines[i].match(date);
  const split=!same&&lines[i+1]&&(lines[i]+' '+lines[i+1]).match(date);
  const match=same||split;
  if(!match)continue;
  if(split)i++;
  const label=match[3].trim()||lines[i+1];
  if(!label||date.test(label)||/^ID\s|^История ШК$|^Информация$/i.test(label))continue;
  events.push({date:match[1],time:match[2],label:label.slice(0,200)});
 }
 return events.slice(0,300);
}

function enrichFinancialGoods(page,root,section,deadline){
 if(section.state==='to-hold')return null;
 return async row=>{
  if(Date.now()>=deadline)return null;
  // Use a single product row and an explicitly named product control.
  const barcode=root.getByRole('button',{name:'ШК '+row.barcode,exact:true});
  if(await barcode.count()!==1)return null;
  const wrapper=barcode.locator('xpath=ancestor::*[@data-index or @data-item-index][1]');
  if(await wrapper.count()!==1||await wrapper.getByRole('button',{name:/^ШК\s*\d+$/}).count()!==1)return null;
  const open=wrapper.getByRole('button',{name:/^(Товар|Информация о товаре|Подробнее о товаре|История ШК)$/i});
  if(await open.count()!==1||!await open.isVisible())return null;
  const dialog=page.getByRole('dialog').filter({visible:true}).filter({has:page.getByText('История ШК',{exact:true})}).last();
  if(await dialog.count())return null;
  try{
   await open.click({timeout:800});
   const tab=dialog.getByText('История ШК',{exact:true});
   await tab.click({timeout:1200});
   await dialog.getByText(/\d{1,2}\s+[а-яё]+\s+\d{4}/i).first().waitFor({timeout:1400});
   return {movement:movementEvents(await dialog.innerText({timeout:600}))};
  }catch{return null}
  finally{
   if(await dialog.count()){
    const close=dialog.getByRole('button',{name:/^Закрыть$/i});
    if(await close.count()===1)await close.click({timeout:700}).catch(()=>{});
    if(await dialog.count())await page.keyboard.press('Escape').catch(()=>{});
   }
  }
 };
}

async function collectPoint(page,point,section){
 const movementDeadline=Date.now()+15000;
 await closeDrawers(page);
 const openPointDrawer=async()=>{
  const pointRow=await revealVirtualText(page.locator('body'),'ID '+point);
  if(!pointRow)throw new WBReadError('point_group_missing');
  await pointRow.click({timeout:5000});
  const opened=page.getByRole('dialog').filter({visible:true}).last();
  await opened.waitFor({state:'visible',timeout:12000});
  await waitGoodsDrawer(page,{groups:section.key==='hanging'});
  return opened;
 };
 let dialog=await openPointDrawer();
 const direct=await dialog.evaluate(extractGoods);
 let goods={rows:direct,complete:false};
 if(section.key==='hanging'&&!direct.length){
  const groupsScan=await scanVirtual(page,dialog,extractHangingGroups);
  const groups=groupsScan.rows.map(row=>row.label);
  if(!groups.length)throw new WBReadError('hanging_groups_not_found');
  const items=[];let complete=groupsScan.complete;
  for(const label of groups){
   let batch;
   for(let attempt=0;attempt<2;attempt++){
    try{
     const target=await revealVirtualText(dialog,label);
     if(!target)throw new WBReadError('hanging_group_not_mounted');
     await target.click({timeout:5000});
     await waitGoodsDrawer(page);
     const inner=page.getByRole('dialog').filter({visible:true}).last();
     const reasonsComplete=await expandVisibleReasons(inner);
     batch=await scanVirtual(page,inner,extractGoods,{enrich:enrichFinancialGoods(page,inner,section,movementDeadline)});
     batch.complete&&=reasonsComplete;
     break;
    }catch(error){
     if(['blocked','authentication_required'].includes(error.code))throw error;
     if(attempt===0){
      await closeDrawers(page).catch(()=>{});
      try{dialog=await openPointDrawer()}catch{break}
     }
    }
   }
   if(batch)items.push(...batch.rows.map(row=>({...row,groupLabel:label})));
   else complete=false;
   complete&&=batch?.complete===true;
   if(label===groups.at(-1))break;
   await closeTopDrawer(page).catch(()=>{complete=false});
   dialog=page.getByRole('dialog').filter({visible:true}).last();
   try{
    if(!await dialog.count())dialog=await openPointDrawer();
    else await waitGoodsDrawer(page,{groups:true});
   }catch{
    await closeDrawers(page).catch(()=>{});
    try{dialog=await openPointDrawer()}catch{complete=false;break}
   }
  }
  goods={rows:items,complete};
 }else goods=await scanVirtual(page,dialog,extractGoods,{enrich:enrichFinancialGoods(page,dialog,section,movementDeadline)});
 await closeDrawers(page).catch(()=>{goods.complete=false});return goods;
}
export function extractTicketRows(root){
 const result=[];
 for(const button of root.querySelectorAll('button')){
  const m=button.innerText.trim().match(/^№\s*(\d+)$/);if(!m)continue;
  let el=button.parentElement,card=null;
  for(let depth=0;el&&depth<9;depth++,el=el.parentElement){
   const text=el.innerText||'';
   if([...el.querySelectorAll('button')].filter(node=>/^№\s*\d+$/.test(node.innerText.trim())).length>1)break;
   if(/\bID\s+\d+/.test(text)&&/\d{2}\.\d{2}\.\d{4}/.test(text)){card=el;break}
  }
  if(!card)continue;
  const lines=card.innerText.split('\n').map(x=>x.trim()).filter(Boolean);
  const status=lines.find(x=>/^(?:В работе|Новый|Реш[её]н[а-яё]*|Закрыт[а-яё]*|Ожидает|Отмен[её]н[а-яё]*|Заверш[её]н[а-яё]*|На рассмотрении|Переоткрыт)(?:\s|$)/i.test(x))||null;
  const at=lines.findIndex(x=>x.startsWith('№'));
  result.push({number:m[1],point:card.innerText.match(/\bID\s+(\d+)/)?.[1]||null,status,
   title:lines[at-1]||null,created_local:lines.find(x=>/^\d{2}\.\d{2}\.\d{4}/.test(x))||null,
   position:JSON.stringify([card.innerText.match(/\bID\s+(\d+)/)?.[1],m[1]])});
 }
 return result;
}
export async function chooseTicketPoint(page,point){
 const multi=page.getByTestId('new-tickets-point-multiselect');
 if(await multi.count()){
  if(await multi.getAttribute('aria-expanded')!=='true')await multi.click({timeout:5000});
  const reset=page.getByTestId('new-tickets-point-multiselect-reset');
  if(await reset.count()&&await reset.isVisible()&&await reset.isEnabled())await reset.click({timeout:5000});
  if(await multi.getAttribute('aria-expanded')!=='true')await multi.click({timeout:5000});
  await page.getByText('ID '+point,{exact:true}).last().click({timeout:5000});
  if(await multi.getAttribute('aria-expanded')==='true'){
   await page.keyboard.press('Escape');await sleep(250);
   if(await multi.getAttribute('aria-expanded')==='true')await page.getByRole('heading',{name:'Тикеты',exact:true}).click({timeout:10000});
   await page.waitForFunction(()=>document.querySelector('[data-testid="new-tickets-point-multiselect"]')?.getAttribute('aria-expanded')!=='true',null,{timeout:5000});
  }
  if(await multi.getAttribute('aria-expanded')==='true')throw new WBReadError('ticket_point_filter_open');
  await sleep(500);return;
 }

 const select=page.locator('[data-testid$="tickets-point-select"]').last();
 if(!await select.count()){
  const candidates=page.locator('[data-testid]').filter({hasText:'Адрес или ID ПВЗ'});
  if(!await candidates.count())throw new WBReadError('ticket_point_filter_missing');
  await candidates.last().click();
 }else{
  if((await select.innerText()).includes(point))return;
  await select.click();
 }
 const option=page.getByText('ID '+point,{exact:true}).last();await option.click();await sleep(500);
 if(await select.count()&&!(await select.innerText()).includes(point))throw new WBReadError('ticket_point_mismatch');
}
async function openTicket(page,{number,point}){
 await closeDrawers(page);
 const button=page.getByRole('button',{name:'№ '+number,exact:true}).first();
 await button.waitFor({state:'visible',timeout:8000});
 const handle=await button.evaluateHandle((button,expectedPoint)=>{
  let el=button.parentElement;
  for(let n=0;el&&n<9;n++,el=el.parentElement){
   const text=el.innerText||'';
   if([...el.querySelectorAll('button')].filter(node=>/^№\s*\d+$/.test(node.innerText.trim())).length>1)return null;
   const point=text.match(/\bID\s+(\d+)/)?.[1];
   if(point&&/\d{2}\.\d{2}\.\d{4}/.test(text))return point===expectedPoint?el:null;
  }return null;
 },point);
 try{
  const element=handle.asElement();if(!element)throw new WBReadError('ticket_card_not_found');
  const drawer=page.getByRole('dialog').last();
  try{
   await element.click({timeout:2500});
   await drawer.waitFor({state:'visible',timeout:3000});
  }catch(error){
   if(error.name!=='TimeoutError')throw error;
   // Sticky controls can cover the center of a virtual card. Click only the
   // already matched card, checking that virtualization did not recycle it.
   if(!await drawer.isVisible())await element.evaluate((card,{number,point})=>{
    const text=card.innerText||'';
    if(!card.isConnected||![...card.querySelectorAll('button')].some(node=>node.innerText.trim().match(/^№\s*(\d+)$/)?.[1]===number)||text.match(/\bID\s+(\d+)/)?.[1]!==point)throw Error('ticket_card_recycled');
    card.click();
   },{number,point});
   await drawer.waitFor({state:'visible',timeout:10000});
  }
  const banner=await drawer.innerText();
  const heading=await drawer.getByRole('heading').first().textContent({timeout:2000}).catch(()=>null);
  const visibleNumber=(heading||banner).match(/№\s*(\d+)/)?.[1]||banner.match(/№\s*(\d+)/)?.[1];
  if(visibleNumber!==number&&!(!visibleNumber&&banner.split(/[^0-9]+/).includes(number)))throw new WBReadError('ticket_number_mismatch');
 }finally{await handle.dispose()}
}
export function extractMessages(root){
 const months=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
 const days=[...root.querySelectorAll('strong')].map(el=>{
  const m=el.innerText.match(/(\d+)\s+([а-я]+)\s+(\d{4})/i);
  if(!m||!months.includes(m[2].toLowerCase()))return null;
  return {el,date:`${m[1].padStart(2,'0')}.${String(months.indexOf(m[2].toLowerCase())+1).padStart(2,'0')}.${m[3]}`};
 }).filter(Boolean);
 const result=[];const occurrences=new Map();
 for(const sub of root.querySelectorAll('sub')){
  if(!/^\d{1,2}:\d{2}(?::\d{2})?$/.test(sub.innerText.trim()))continue;
  let candidate=sub.parentElement,card=null;
  for(let n=0;candidate&&n<10;n++,candidate=candidate.parentElement){
   if(candidate.querySelectorAll('sub').length!==1)break;
   if(days.some(day=>candidate.contains(day.el)))break;
   if(candidate===root)break;
   if(candidate.querySelector('p,a[href]'))card=candidate;
  }
  if(!card){result.push({unmapped:true,position:'unmapped:'+result.length});continue}
  {
   const lines=card.innerText.split('\n').map(x=>x.trim()).filter(Boolean);
   const firstParagraph=card.querySelector('p')?.innerText.trim().split('\n')[0];
   const author=lines[0]===firstParagraph?'':lines[0];
   // DOM DOCUMENT_POSITION_FOLLOWING = 4, also works in HTML-only regression tests.
   const date=days.filter(x=>Boolean(x.el.compareDocumentPosition(card)&4)).at(-1)?.date;
   const paragraphs=[...card.querySelectorAll('p')].map(x=>x.innerText.trim()).filter(Boolean);
   const role=/^(Менеджер|Поддержка WB|Сотрудник поддержки)$/i.test(author)?'wb_support':
     /^(Бот|Система)$/i.test(author)?'system':/^(?:[0-9]{5,15}|Вы)$/.test(author)?'user':'unknown';
   const attachments=[...card.querySelectorAll('a[href]')].map(a=>a.href).filter(x=>x.startsWith('https://')).slice(0,100);
   if(!paragraphs.length&&!attachments.length)continue;
   const signature=JSON.stringify([author,paragraphs,attachments,sub.innerText.trim()]);
   const index=card.closest('[data-index],[data-item-index]');
   const itemIndex=index?.getAttribute('data-index')??index?.getAttribute('data-item-index');
   const key=JSON.stringify([itemIndex??date,signature]);
   const occurrence=(occurrences.get(key)||0)+1;occurrences.set(key,occurrence);
   result.push({author,role,text:paragraphs.join('\n'),dateLocal:date?date+' '+sub.innerText.trim().split(':').slice(0,2).join(':'):'',attachments,
    position:key+'#'+occurrence});
  }
 }
 return result;
}
async function ticketDetail(page,row){
 await openTicket(page,row);
 const dialog=page.getByRole('dialog').last();
 await dialog.locator('sub').filter({hasText:/^\s*\d{1,2}:\d{2}(?::\d{2})?\s*$/}).first().waitFor({state:'visible',timeout:10000});
 const all=await scanVirtual(page,dialog,extractMessages,{settleUnlisted:true});
 const mapped=all.rows.filter(message=>!message.unmapped);
 if(!mapped.length)throw new WBReadError('messages_not_mapped');
 // Unknown blocks matching the signed-in user's display name are user messages.
 const header=(await page.getByTestId('app-header').innerText()).split('\n').map(x=>x.trim());
 const idIndex=header.findIndex(x=>/^ID\s/.test(x));
 const user=idIndex>0?header[idIndex-1]:null;
 const messages=normalizeMessages(mapped.map(m=>({...m,role:user&&m.role==='unknown'&&m.author===user?'user':m.role})));
 await closeDrawers(page).catch(()=>{});
 return {messages,history_complete:all.complete&&mapped.length===all.rows.length};
}
export function calendarDayIndex(root,{day,month,year}){
 const months=['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
 const nodes=[...root.querySelectorAll('button,[role="button"],[role="gridcell"],td,span')];
 const choices=[];
 for(let index=0;index<nodes.length;index++){
  const element=nodes[index],text=(element.innerText||element.textContent||'').trim();
  if(text!==String(day)||!element.getClientRects().length||element.closest('[aria-disabled="true"],[disabled],[data-disabled="true"]'))continue;
  for(let parent=element.parentElement,depth=0;parent&&depth<9;parent=parent.parentElement,depth++){
   const label=(parent.innerText||parent.textContent||'').toLocaleLowerCase('ru').replace(/\s+/g,' ');
   if(label.includes(months[month])&&label.includes(String(year))&&!months.some((name,i)=>i!==month&&label.includes(name))){choices.push({index,score:element.tagName==='BUTTON'?0:element.getAttribute('role')==='button'?1:2});break}
  }
 }
 choices.sort((a,b)=>a.score-b.score||a.index-b.index);return choices[0]?.index??-1;
}
export async function selectCollectionPeriod(page,heading){
 const start='01.10.2026',end=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date());
 try{
  const existing=await page.locator('input').evaluateAll(nodes=>nodes.map(el=>el.value).join(' '));
  if(existing.includes(start)&&existing.includes(end))return {verified:true,start:'2026-10-01',end:end.split('.').reverse().join('-')};
  const trigger=page.getByText('Период',{exact:true}).first();
  if(await trigger.count())await trigger.click({timeout:5000});
  else{const dateInput=page.locator('input').filter({visible:true});let clicked=false;for(let i=0;i<await dateInput.count();i++)if(/\d{2}\.\d{2}\.\d{4}/.test(await dateInput.nth(i).inputValue())){await dateInput.nth(i).click();clicked=true;break}if(!clicked)return {verified:false,error:'period_control_missing'}}
  const inputs=page.locator('input').filter({visible:true});const candidates=[];const evidence=[];
  for(let i=0;i<await inputs.count();i++){
   const input=inputs.nth(i),info=await input.evaluate(el=>({type:el.type,placeholder:el.placeholder,value:el.value,readOnly:el.readOnly}));evidence.push(info);
   if(!['checkbox','radio','search','button','submit','hidden'].includes(info.type)&&info.placeholder!=='Поиск'&&!info.readOnly)candidates.push({input,info});
  }
  if(candidates.length===1){
   const input=candidates[0].input;
   try{
    await input.fill(start+' - '+end);await input.press('Tab');await sleep(300);
    const accepted=await input.inputValue();
    if(accepted.includes(start)&&accepted.includes(end)&&await input.getAttribute('aria-invalid')!=='true'){
     await page.getByRole('heading',{name:heading,exact:true}).click();await page.waitForLoadState('networkidle',{timeout:10000}).catch(()=>{});
     const persisted=await page.locator('input').evaluateAll(nodes=>nodes.map(el=>el.value).join(' '));
     if(persisted.includes(start)&&persisted.includes(end))return {verified:true,start:'2026-10-01',end:end.split('.').reverse().join('-')};
    }
    await input.click();
   }catch{}
   const calendar=[];
   for(const date of [{day:1,month:9,year:2026},(()=>{const parts=end.split('.').map(Number);return {day:parts[0],month:parts[1]-1,year:parts[2]}})()]){
    const index=await page.locator('body').evaluate(calendarDayIndex,date);
    if(index<0){const detail=await page.locator('body').evaluate(readOrganizationEvidence);await page.keyboard.press('Escape');return {verified:false,inputs:evidence,calendar:detail.page}}
    await page.locator('button,[role="button"],[role="gridcell"],td,span').nth(index).click({timeout:10000});await sleep(350);calendar.push(date);
   }
   const values=await page.locator('input').evaluateAll(nodes=>nodes.map(el=>el.value).join(' '));
   const text=values+' '+await page.locator('body').innerText();
   const verified=text.includes(start)&&text.includes(end);
   if(!verified)return {verified:false,inputs:evidence,values,calendar,display:text.slice(-2200)};
   await page.getByRole('heading',{name:heading,exact:true}).click();await page.waitForLoadState('networkidle',{timeout:10000}).catch(()=>{});
   return {verified:true,start:'2026-10-01',end:end.split('.').reverse().join('-')};
  }
  if(candidates.length!==2){const detail=await page.locator('body').evaluate(readOrganizationEvidence);await page.keyboard.press('Escape');return {verified:false,inputs:evidence,calendar:detail.page}}
  for(const [i,item] of candidates.entries()){
   const date=i===0?start:end;await item.input.fill(item.info.type==='date'?date.split('.').reverse().join('-'):date);await item.input.press('Tab');
  }
  const values=await Promise.all(candidates.map(item=>item.input.inputValue()));
  const verified=(values[0].includes(start)||values[0]==='2026-10-01')&&(values[1].includes(end)||values[1]===end.split('.').reverse().join('-'));
  if(!verified)return {verified:false,inputs:evidence,values};
  const apply=page.getByRole('button',{name:/^(Применить|Показать)$/});
  if(await apply.count()&&await apply.first().isVisible()&&await apply.first().isEnabled())await apply.first().click();
  else await page.getByRole('heading',{name:heading,exact:true}).click();
  await page.waitForLoadState('networkidle',{timeout:10000}).catch(()=>{});
  return {verified:true,start:'2026-10-01',end:end.split('.').reverse().join('-')};
 }catch(error){await page.keyboard.press('Escape').catch(()=>{});return {verified:false,error:String(error.message).slice(0,120)}}
}

export async function syncWBDisputes(page,{registry,tickets=[],saveScope,onProgress=()=>{},renewPage=async current=>current,categories=['hanging','brak','podmena','tickets'],includeFinancial=false,budgetMs=100*60000}={}){
 const started=Date.now(),report={started_at:stamp(),state:'running',checked_points:0,rows:0,tickets:0,sections:[]};
 const checkedPoints=new Set(),detailQueue=[];
 const openScope=async(url,heading,org)=>{
  page=await renewPage(page);
  await releaseBrowserMemory(page);
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
  // A WB organization can also be scoped to a tab. Verify/select it in the new
  // renderer before accepting either populated records or an empty list.
  await selectOrganization(page,org.name_exact,{pointIds:org.points.map(point=>point.wb_point_id),allPointIds:registry.flatMap(item=>item.points.map(point=>point.wb_point_id))});
  if(new URL(page.url()).pathname!==new URL(url).pathname)await navigate(page,url,heading,org.name_exact);
  else await pageReady(page,heading);
 };

 report.dialogues_attempted=0;report.dialogues_failed=0;
 if(!await page.getByTestId('app-header').count()){
  await page.goto(ORIGIN+'/pickpoints',{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForFunction(()=>document.querySelector('[data-testid="app-header"]')?.innerText.trim()||/Отправить код|Выберите организацию|verify you are human/.test(document.body.innerText),null,{timeout:60000}).catch(()=>{});
  const visible=await page.locator('body').innerText();
  if(/Отправить код/.test(visible)||/\/(login|auth|signin)(\/|$)/.test(new URL(page.url()).pathname))throw new WBReadError('authentication_required');
  if(/verify you are human|checking your browser|unusual traffic/i.test(visible))throw new WBReadError('blocked');
  if(/Выберите организацию/.test(visible)){
   await selectOrganization(page,registry[0].name_exact,{pointIds:registry[0].points.map(p=>p.wb_point_id),allPointIds:registry.flatMap(o=>o.points.map(p=>p.wb_point_id))});
   await page.getByTestId('app-header').waitFor({state:'visible',timeout:30000});
  }
 }
 const baseSections=[{key:'hanging',heading:'Зависшие ШК',path:'/hanging-goods/to-hold',category:'Зависший'},
  {key:'brak',heading:'Брак',path:'/defects/to-hold',category:'Брак'},
  {key:'podmena',heading:'Подмены',path:'/replace-goods/to-hold',category:'Подмена'}];
 const sections=baseSections.flatMap(section=>[
  {...section,state:'to-hold',tab:'К удержанию'},
  {...section,state:'withheld',tab:'Удержано'},
  {...section,state:'paid',tab:'Доплачено'}
 ]);
 const financialStates=new Set(['withheld','paid']);
 const currentEvidence=await page.locator('body').evaluate(readOrganizationEvidence).catch(()=>null);
 const active=currentEvidence&&registry.find(org=>verifyOrganization(currentEvidence,org.name_exact,{pointIds:org.points.map(p=>p.wb_point_id),allPointIds:registry.flatMap(o=>o.points.map(p=>p.wb_point_id))}));
 const ordered=active?[active,...registry.filter(org=>org!==active)]:registry;
 // Persist retention scopes and ticket lists before opening individual replies.
 const phases=[...(includeFinancial?['secondary']:[]),'inventory',...(categories.includes('tickets')?['tickets','details']:[])];
 for(const phase of phases)for(const org of ordered){
  report.phase=phase;
  if(phase==='details'&&!detailQueue.some(task=>task.organization===org.research_id))continue;
  if(Date.now()-started>budgetMs){report.sections.push({key:'budget',state:'partial'});break}
  report.current={organization:org.research_id,section:'organization',step:'selecting_organization'};onProgress(report);
  const selectScopeOrganization=async()=>{
   if(!await page.getByTestId('app-header').count())await page.goto(ORIGIN+'/pickpoints',{waitUntil:'domcontentloaded',timeout:45000});
   await selectOrganization(page,org.name_exact,{pointIds:org.points.map(p=>p.wb_point_id),allPointIds:registry.flatMap(o=>o.points.map(p=>p.wb_point_id))});
  };
  try{
   try{await selectScopeOrganization()}
   catch(error){
    if(error.code!=='wb_page_not_ready'||Date.now()-started>=budgetMs)throw error;
    page=await renewPage(page);
    await page.goto(ORIGIN+'/pickpoints',{waitUntil:'domcontentloaded',timeout:45000});
    await selectScopeOrganization();
   }
  }catch(e){const state=e.code||'organization_unavailable';report.sections.push({key:org.research_id,state,errorType:e.name,message:String(e.message||'').split('\n')[0].slice(0,240),failureLog:String(e.message||'').slice(0,1800),diagnostic:e.diagnostic||await page.locator('body').evaluate(readOrganizationEvidence).catch(()=>({}))});onProgress(report);if(['blocked','authentication_required'].includes(state)){report.state=state;return report}continue}
  for(const section of sections.filter(x=>categories.includes(x.key)&&(phase==='inventory'?(x.state==='to-hold'):phase==='secondary'?financialStates.has(x.state):false))){
   if(Date.now()-started>budgetMs){report.sections.push({key:'budget:goods',state:'partial'});break}
   for(let attempt=0;attempt<2;attempt++){
    report.current={organization:org.research_id,section:section.key,state:section.state,step:'opening_section',attempt:attempt+1};onProgress(report);
    try{
     await openScope(ORIGIN+section.path,section.heading,org);
     if(section.state!=='to-hold'){
      await page.getByRole('button',{name:section.tab,exact:true}).click();
      await sleep(400);await pageReady(page,section.heading);
     }
     // Verify the date range after switching tabs, since WB can reset filters.
     const dateProof=await selectCollectionPeriod(page,section.heading);
     if(!dateProof.verified)report.sections.push({key:org.research_id+':'+section.key+':'+section.state+':date-range',state:'date_range_unverified',diagnostic:dateProof});
     await page.waitForFunction(()=>/Товаров\s*\d|Нет товаров/.test(document.body?.innerText||''),null,{timeout:20000});
     const groupScan=await scanVirtual(page,page.locator('body'),extractPointGroups);
     const groups=groupScan.rows;
     const proof=await page.locator('body').evaluate(readGoodsScopeProof);
     const absentConfirmed=dateProof.verified&&groupScan.complete&&groups.every(group=>org.points.some(point=>point.wb_point_id===group.point))&&organizationLabelMatches(proof.header,org.name_exact)&&(proof.declaredPoints===new Set(groups.map(group=>group.point)).size||proof.noGoods);
     let sectionComplete=groupScan.complete;
     for(const point of org.points){
      if(Date.now()-started>budgetMs){sectionComplete=false;break}
      report.current={organization:org.research_id,point:point.wb_point_id,section:section.key,state:section.state,step:'reading_point'};onProgress(report);
      const group=groups.find(x=>x.point===point.wb_point_id);
      const scope={organization:org.research_id,point:point.wb_point_id,category:section.category,state:section.state,key:section.key};
      // Missing group is not proof of zero goods: WB may not have mounted it,
      // or the organization switch may have failed. Never archive existing rows.
      if(!group){
       if(absentConfirmed){
        await saveScope({...scope,scope:`wb:${org.research_id}:${point.wb_point_id}:${section.key}:${section.state}`,rows:[],complete:true,status:'ok',expected_count:0,finished_at:stamp()});
        checkedPoints.add(org.research_id+':'+point.wb_point_id);report.checked_points=checkedPoints.size;
        report.sections.push({key:org.research_id+':'+point.wb_point_id+':'+section.key+':'+section.state,state:'ok',evidence:'complete_unfiltered_group_list',count:0});onProgress(report);continue;
       }
       await saveScope({...scope,scope:`wb:${org.research_id}:${point.wb_point_id}:${section.key}:${section.state}`,
        rows:[],complete:false,status:'point_group_missing',expected_count:null,finished_at:stamp()});
       sectionComplete=false;
       report.sections.push({key:org.research_id+':'+point.wb_point_id+':'+section.key+':'+section.state,state:'point_group_missing',diagnostic:await page.locator('body').evaluate(readOrganizationEvidence).catch(()=>({})),groupIds:groups.map(group=>group.point)});
       onProgress(report);
       continue;
      }
      let result={rows:[],complete:true};
      if(group?.count>0){
       try{result=await collectPoint(page,point.wb_point_id,section)}
       catch(error){
        if(error.name!=='TimeoutError')throw error;
        await closeDrawers(page).catch(()=>{});
        const pointScope=`wb:${org.research_id}:${point.wb_point_id}:${section.key}:${section.state}`;
        await saveScope({...scope,scope:pointScope,rows:[],complete:false,status:'drawer_timeout',finished_at:stamp()});
        report.sections.push({key:pointScope,state:'drawer_timeout'});
        onProgress(report);
        sectionComplete=false;
        continue;
       }
      }
      const complete=dateProof.verified&&groupScan.complete&&result.complete&&(!group||result.rows.length===group.count);
      const rows=observationRows(result.rows,{...scope,date_range_verified:dateProof.verified}).filter(row=>eligibleObservation(row));
      const saved=await saveScope({...scope,scope:`wb:${org.research_id}:${point.wb_point_id}:${section.key}:${section.state}`,rows,complete,
        status:complete?'ok':'partial',expected_count:group?.count||0,finished_at:stamp()});
      sectionComplete&&=complete&&saved.complete!==false;
      report.rows+=rows.length;checkedPoints.add(org.research_id+':'+point.wb_point_id);report.checked_points=checkedPoints.size;onProgress(report);
     }
     report.sections.push({key:org.research_id+':'+section.key+':'+section.state,state:sectionComplete?'ok':'partial'});
     break;
    }catch(e){const diagnostic=await page.locator('body').evaluate(readOrganizationEvidence).catch(()=>({}));await closeDrawers(page).catch(()=>{});const state=e.code||'unavailable';
     if(attempt===0&&e.name==='TimeoutError'&&Date.now()-started<budgetMs)continue;
     report.sections.push({key:org.research_id+':'+section.key+':'+section.state,state,errorType:e.name,message:String(e.message||'').split('\n')[0].slice(0,200),diagnostic});onProgress(report);
     await saveScope({scope:`wb:${org.research_id}:all:${section.key}:${section.state}`,organization:org.research_id,key:section.key,status:state,complete:false,rows:[]}).catch(()=>{});
     if(['blocked','authentication_required'].includes(state)){report.state=state;return report}
    }
   }
  }
  if(phase==='tickets')for(const namespace of ['legacy','new'])for(const point of org.points){
   report.current={organization:org.research_id,point:point.wb_point_id,section:'tickets',namespace,step:'reading_tickets'};onProgress(report);
   if(Date.now()-started>budgetMs){report.sections.push({key:'budget:tickets',state:'partial'});break}
   const scope=`wb:${org.research_id}:${point.wb_point_id}:tickets:${namespace}`;
   try{
    const readList=async()=>{
     await openScope(ORIGIN+(namespace==='legacy'?'/tickets':'/tickets/new-tickets'),'Тикеты',org);
     const search=page.getByPlaceholder('Поиск',{exact:true}).filter({visible:true}).last();if(await search.count())await search.fill('',{timeout:5000});
     await chooseTicketPoint(page,point.wb_point_id);
     await page.waitForFunction(point=>[...document.querySelectorAll('button')].some(button=>{
      if(!/^№\s*\d+$/.test(button.innerText.trim()))return false;
      for(let el=button.parentElement,i=0;el&&i<9;el=el.parentElement,i++){
       const text=el.innerText||'';
       if([...el.querySelectorAll('button')].filter(node=>/^№\s*\d+$/.test(node.innerText.trim())).length>1)break;
       if(text.match(/\bID\s+(\d+)/)?.[1]===point)return true;
      }
      return false;
     })||/Нет данных|Нет обращений|Нет тикетов|Ничего не найдено|Обращений пока нет|Тикетов пока нет/.test(document.body?.innerText||''),point.wb_point_id,{timeout:20000});
     return scanVirtual(page,page.locator('body'),extractTicketRows);
    };
    let list;
    try{list=await readList()}catch(error){
     if(error.name!=='TimeoutError'&&error.code!=='ticket_point_filter_open')throw error;
     list=await readList();
    }
    const found=list.rows.filter(x=>x.point===point.wb_point_id);
    const cacheFor=row=>tickets.find(x=>x.organization_research_id===org.research_id&&x.namespace===namespace&&x.ticket_number===row.number);
    found.sort((a,b)=>Date.parse(cacheFor(a)?.last_attempt_at||'1970-01-01')-Date.parse(cacheFor(b)?.last_attempt_at||'1970-01-01'));
    const saved=[];let detailsComplete=true;
    for(const row of found){
     if(Date.now()-started>budgetMs){detailsComplete=false;break}
     const ticket={ticket_number:row.number,status:row.status,title:row.title,created_local:row.created_local,
      namespace,wb_point_id:point.wb_point_id,organization_research_id:org.research_id};
     const cached=cacheFor(row);
     if(!/^(?:реш[её]н|закрыт|заверш[её]н|отмен[её]н)/i.test(row.status||'')
       && localDate(row.created_local) >= '2026-09-30T21:00:00.000Z'
       && ticketNeedsDetail(row,cached)){detailQueue.push({organization:org.research_id,point:point.wb_point_id,namespace,row,cached,ticket});report.pending_dialogues=detailQueue.length;}
     saved.push(ticket);report.tickets++;
     if(saved.length>=20){await saveScope({scope,organization:org.research_id,point:point.wb_point_id,key:'tickets',namespace,tickets:saved.splice(0),complete:false,status:'running'});onProgress(report)}
    }
    if(!found.length&&!/Нет данных|Нет обращений|Нет тикетов|Ничего не найдено|Обращений пока нет|Тикетов пока нет/.test(await page.locator('body').innerText()))throw new WBReadError('ticket_list_not_mapped');
    await saveScope({scope,organization:org.research_id,point:point.wb_point_id,key:'tickets',namespace,tickets:saved,
      complete:list.complete&&detailsComplete,status:list.complete&&detailsComplete?'ok':'partial'});
    report.sections.push({key:scope,state:list.complete&&detailsComplete?'ok':'partial'});onProgress(report);
   }catch(e){const state=e.code||'unavailable';report.sections.push({key:scope,state,errorType:e.name,message:String(e.message||'').split('\n')[0].slice(0,200),diagnostic:await page.locator('body').evaluate(readOrganizationEvidence).catch(()=>({}))});onProgress(report);
    await saveScope({scope,organization:org.research_id,point:point.wb_point_id,key:'tickets',namespace,status:state,complete:false}).catch(()=>{});
    if(['blocked','authentication_required'].includes(state)){report.state=state;return report}
   }
  }
  if(phase==='details'&&categories.includes('tickets'))for(const namespace of ['legacy','new'])for(const point of org.points){
   const pending=detailQueue.filter(task=>task.organization===org.research_id&&task.point===point.wb_point_id&&task.namespace===namespace);
   if(!pending.length)continue;
   if(Date.now()-started>budgetMs){report.sections.push({key:'budget:details',state:'partial'});break}
   const scope=`wb:${org.research_id}:${point.wb_point_id}:ticket-history:${namespace}`;
   let complete=true,failed=0,firstFailure=null;
   try{
    report.current={organization:org.research_id,point:point.wb_point_id,section:'tickets',namespace,step:'reading_dialogues'};onProgress(report);
    await openScope(ORIGIN+(namespace==='legacy'?'/tickets':'/tickets/new-tickets'),'Тикеты',org);
    const search=page.getByPlaceholder('Поиск',{exact:true}).filter({visible:true}).last();if(await search.count())await search.fill('',{timeout:5000});
    await chooseTicketPoint(page,point.wb_point_id);
    pending.sort((a,b)=>Date.parse(a.cached?.last_checked_at||'1970-01-01')-Date.parse(b.cached?.last_checked_at||'1970-01-01'));
    let detailsOnPage=0;
    for(const task of pending){
     if(Date.now()-started>budgetMs){complete=false;break}
     const ticket={...task.ticket};
     try{
      if(detailsOnPage>=10){await openScope(ORIGIN+(namespace==='legacy'?'/tickets':'/tickets/new-tickets'),'Тикеты',org);await chooseTicketPoint(page,point.wb_point_id);detailsOnPage=0;}
      detailsOnPage++;
      await closeDrawers(page).catch(()=>{});await page.keyboard.press('Escape');
      const search=page.getByPlaceholder('Поиск',{exact:true}).filter({visible:true}).last();await search.fill(ticket.ticket_number,{timeout:5000});await sleep(400);
      for(let attempt=0;attempt<2;attempt++){
       try{
        Object.assign(ticket,await ticketDetail(page,task.row));
        if(ticket.history_complete)break;
       }catch(error){
        if(attempt||['blocked','authentication_required'].includes(error.code))throw error;
       }
       await closeDrawers(page).catch(()=>{});
      }
      if(!ticket.history_complete){complete=false;failed++;ticket.detail_error='history_scan_incomplete'}
     }catch(e){
      if(['blocked','authentication_required'].includes(e.code)){report.state=e.code;return report}
      complete=false;failed++;ticket.detail_error=e.code||'detail_unavailable';
      if(!firstFailure)firstFailure={ticket:ticket.ticket_number,errorType:e.name,message:String(e.message||'').split('\n')[0].slice(0,200)};
      await closeDrawers(page).catch(()=>{});
     }
     await saveScope({scope,organization:org.research_id,point:point.wb_point_id,key:'ticket_history',namespace,tickets:[ticket],complete:false,status:'running'});
     report.dialogues_attempted++;report.pending_dialogues=detailQueue.length-report.dialogues_attempted;report.dialogues_failed+=ticket.history_complete?0:1;onProgress(report);
    }
    await saveScope({scope,organization:org.research_id,point:point.wb_point_id,key:'ticket_history',namespace,complete,status:complete?'ok':'partial'});
    report.sections.push({key:scope,state:complete?'ok':'partial',failed,...(firstFailure?{firstFailure}:{})});onProgress(report);
   }catch(e){
    const state=e.code||'unavailable';report.sections.push({key:scope,state,errorType:e.name,message:String(e.message||'').split('\n')[0].slice(0,200)});onProgress(report);
    await saveScope({scope,organization:org.research_id,point:point.wb_point_id,key:'ticket_history',namespace,complete:false,status:state}).catch(()=>{});
    if(['blocked','authentication_required'].includes(state)){report.state=state;return report}
   }
  }

 }
 const hasFailures=report.sections.some(section=>section.state!=='ok');
 const savedScopes=report.sections.some(section=>section.state==='ok');
 report.state=hasFailures?(savedScopes?'partial':'unavailable'):'ok';
 report.finished_at=stamp();
 return report;
}
