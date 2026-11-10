import {selectOrganization,readOrganizationEvidence,verifyOrganization,organizationLabelMatches} from './disputes-organizations.mjs';
import {observationRows,normalizeMessages,ticketNeedsDetail} from './disputes-model.mjs';
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
async function navigate(page,url,heading,org){
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
async function scanVirtual(page,root,extract,{maxWindows=150}={}){
 const found=new Map();let bottomPasses=0,lastSize=0;
 const scroller=root.getByTestId('virtuoso-scroller').last();
 const has=await scroller.count();
 if(has)await scroller.evaluate(e=>{e.scrollTop=0});
 for(let window=0;window<maxWindows;window++){
  await sleep(180);
  const rows=await root.evaluate(extract);
  rows.forEach((row,index)=>found.set(row.position??(row.point&&!row.number?'point:'+row.point:JSON.stringify([row.barcode,row.number,row.groupLabel,row.text,index])),row));
  if(!has)return {rows:[...found.values()],complete:true};
  const metrics=await scroller.evaluate(e=>({top:e.scrollTop,height:e.clientHeight,total:e.scrollHeight}));
  const bottom=metrics.top+metrics.height>=metrics.total-3;
  if(bottom&&found.size===lastSize)bottomPasses++;else bottomPasses=0;
  if(bottomPasses>=3)return {rows:[...found.values()],complete:true};
  lastSize=found.size;
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
  const ticket=chosen.innerText.match(/№\s*(\d{3,})/);
  const dateLabel=lines.findLast(x=>/\d{2}\.\d{2}\.\d{2,4}/.test(x))||'';
  const start=lines.indexOf(title),end=lines.findIndex(x=>/^(В тикет|Оспорить)$/.test(x));
  const reason=lines.slice(start+1,end>=0?end:undefined).filter(x=>x!==amount&&x!==dateLabel).join('\n');
  const wrapper=chosen.closest('[data-index],[data-item-index]');
  let eventId=null;
  for(const el of [chosen,button])for(const key of ['eventId','recordId','defectId','hangingId'])if(el.dataset?.[key])eventId=el.dataset[key];
  out.push({barcode:m[1],title,photo:img?.getAttribute('src'),amount,reason,dateLabel,ticketNumber:ticket?.[1]||null,eventId,
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
async function collectPoint(page,point,section){
 await closeDrawers(page);
 const group=page.locator('body').getByText('ID '+point,{exact:true});
 // A previous complete scan can leave earlier point rows unmounted at the bottom.
 if(!await group.count()){
  const scroller=page.locator('body').getByTestId('virtuoso-scroller').last();
  if(await scroller.count()){
   await scroller.evaluate(e=>{e.scrollTop=0});
   for(let window=0;window<150;window++){
    await sleep(180);if(await group.count())break;
    const atBottom=await scroller.evaluate(e=>e.scrollTop+e.clientHeight>=e.scrollHeight-3);
    if(atBottom)break;
    await scroller.evaluate(e=>{e.scrollTop+=Math.max(120,e.clientHeight*.75)});
   }
  }
 }
 if(!await group.count())throw new WBReadError('point_group_missing');
 await group.first().click({timeout:5000});
 const dialog=page.getByRole('dialog').last();await dialog.waitFor({state:'visible',timeout:12000});
 await sleep(400);
 let goods=await scanVirtual(page,dialog,extractGoods);
 if(section.key==='hanging'&&!goods.rows.length){
  const groups=await dialog.evaluate(extractHangingGroupLabels);
  if(!groups.length)throw new WBReadError('hanging_groups_not_found');
  const outerCount=await page.getByRole('dialog').count();
  const items=[];let complete=true;
  for(const label of groups){
   await page.getByRole('dialog').first().getByText(label,{exact:true}).click({timeout:5000});
   await page.waitForFunction(n=>document.querySelectorAll('[role="dialog"]').length>n,outerCount,{timeout:10000});
   const inner=page.getByRole('dialog').last();await sleep(250);
   const reasonsComplete=await expandVisibleReasons(inner);
   const batch=await scanVirtual(page,inner,extractGoods);
   items.push(...batch.rows.map(x=>({...x,groupLabel:label})));complete&&=batch.complete&&reasonsComplete;
   // Close only the inner drawer. If WB closes both, reopen the original point.
   await closeTopDrawer(page);await sleep(100);
   if(!await page.getByRole('dialog').count()){
    await page.locator('body').getByText('ID '+point,{exact:true}).first().click();
    await page.getByRole('dialog').last().waitFor({state:'visible'});await sleep(300);
   }
  }
  goods={rows:items,complete};
 }
 await closeDrawers(page);return goods;
}
export function extractTicketRows(root){
 const result=[];
 for(const button of root.querySelectorAll('button')){
  const m=button.innerText.trim().match(/^№\s*(\d+)$/);if(!m)continue;
  let el=button.parentElement,card=null;
  for(let depth=0;el&&depth<9;depth++,el=el.parentElement){
   const text=el.innerText||'';
   if((text.match(/№\s*\d+/g)||[]).length>1)break;
   if(/\bID\s+\d+/.test(text)&&/\d{2}\.\d{2}\.\d{4}/.test(text)){card=el;break}
  }
  if(!card)continue;
  const lines=card.innerText.split('\n').map(x=>x.trim()).filter(Boolean);
  const status=lines.find(x=>/^(В работе|Новый|Реш[её]н|Закрыт|Ожидает|Отмен)/i.test(x))||null;
  const at=lines.findIndex(x=>x.startsWith('№'));
  result.push({number:m[1],point:card.innerText.match(/\bID\s+(\d+)/)?.[1]||null,status,
   title:lines[at-1]||null,created_local:lines.find(x=>/^\d{2}\.\d{2}\.\d{4}/.test(x))||null,
   position:card.closest('[data-index]')?.getAttribute('data-index')||m[1]});
 }
 return result;
}
async function chooseTicketPoint(page,point){
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
async function openTicket(page,number){
 await closeDrawers(page);
 const button=page.getByRole('button',{name:'№ '+number,exact:true}).first();
 await button.waitFor({state:'visible',timeout:8000});
 const handle=await button.evaluateHandle(button=>{
  let el=button.parentElement;
  for(let n=0;el&&n<9;n++,el=el.parentElement){
   const text=el.innerText||'';
   if((text.match(/№\s*\d+/g)||[]).length>1)return null;
   if(/\bID\s+\d+/.test(text)&&/\d{2}\.\d{2}\.\d{4}/.test(text))return el;
  }return null;
 });
 const element=handle.asElement();if(!element)throw new WBReadError('ticket_card_not_found');
 await element.click({timeout:5000});await handle.dispose();
 await page.getByRole('dialog').last().waitFor({state:'visible',timeout:10000});
 const banner=await page.getByRole('dialog').last().innerText();
 if(!banner.includes(number))throw new WBReadError('ticket_number_mismatch');
}
export function extractMessages(root){
 const months=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
 const days=[...root.querySelectorAll('strong')].map(el=>{
  const m=el.innerText.match(/(\d+)\s+([а-я]+)\s+(\d{4})/i);
  return m?{el,date:`${m[1].padStart(2,'0')}.${String(months.indexOf(m[2])+1).padStart(2,'0')}.${m[3]}`}:null;
 }).filter(Boolean);
 const result=[];const occurrences=new Map();
 for(const sub of root.querySelectorAll('sub')){
  if(!/^\d{1,2}:\d{2}$/.test(sub.innerText.trim()))continue;
  let candidate=sub.parentElement,card=null;
  for(let n=0;candidate&&n<10;n++,candidate=candidate.parentElement){
   if(candidate.querySelectorAll('sub').length!==1)break;
   if(candidate.querySelector('p')&&!candidate.querySelector('strong'))card=candidate;
   if(candidate===root)break;
  }
  if(card){
   const lines=card.innerText.split('\n').map(x=>x.trim()).filter(Boolean),author=lines[0];
   // DOM DOCUMENT_POSITION_FOLLOWING = 4, also works in HTML-only regression tests.
   const date=days.filter(x=>Boolean(x.el.compareDocumentPosition(card)&4)).at(-1)?.date;
   const paragraphs=[...card.querySelectorAll('p')].map(x=>x.innerText.trim()).filter(Boolean);
   if(!paragraphs.length)continue;
   const role=/^(Менеджер|Поддержка WB|Сотрудник поддержки)$/.test(author)?'wb_support':
     /^(Бот|Система)$/.test(author)?'system':'unknown';
   const attachments=[...card.querySelectorAll('a[href]')].map(a=>a.href).filter(x=>x.startsWith('https://')).slice(0,100);
   const signature=JSON.stringify([date,author,paragraphs,sub.innerText]);
   const occurrence=(occurrences.get(signature)||0)+1;occurrences.set(signature,occurrence);
   result.push({author,role,text:paragraphs.join('\n'),dateLocal:date?date+' '+sub.innerText.trim():'',attachments,
    position:card.closest('[data-index]')?.getAttribute('data-index')||signature+'#'+occurrence});
  }
 }
 return result;
}
async function ticketDetail(page,row){
 await openTicket(page,row.number);
 const dialog=page.getByRole('dialog').last();
 const all=await scanVirtual(page,dialog,extractMessages);
 if(!all.rows.length)throw new WBReadError('messages_not_mapped');
 // Unknown blocks matching the signed-in user's display name are user messages.
 const header=(await page.getByTestId('app-header').innerText()).split('\n').map(x=>x.trim());
 const user=header[header.findIndex(x=>/^ID\s/.test(x))-1];
 const messages=normalizeMessages(all.rows.map(m=>({...m,role:m.role==='unknown'&&m.author===user?'user':m.role})));
 await closeDrawers(page).catch(()=>{});
 return {messages,history_complete:all.complete};
}
export async function syncWBDisputes(page,{registry,tickets=[],saveScope,onProgress=()=>{},categories=['hanging','tickets','brak','podmena'],budgetMs=100*60000}={}){
 const started=Date.now(),report={started_at:stamp(),state:'running',checked_points:0,rows:0,tickets:0,sections:[]};
 const checkedPoints=new Set(),detailQueue=[];
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
 const sections=baseSections.flatMap(x=>['to-hold','withheld','paid'].map((state,i)=>({...x,state,tab:['К удержанию','Удержано','Доплачено'][i]})));
 const currentEvidence=await page.locator('body').evaluate(readOrganizationEvidence).catch(()=>null);
 const active=currentEvidence&&registry.find(org=>verifyOrganization(currentEvidence,org.name_exact,{pointIds:org.points.map(p=>p.wb_point_id),allPointIds:registry.flatMap(o=>o.points.map(p=>p.wb_point_id))}));
 const ordered=active?[active,...registry.filter(org=>org!==active)]:registry;
 for(const phase of ['inventory','details','secondary'])for(const org of ordered){
  report.phase=phase;
  if(phase==='details'&&!detailQueue.some(task=>task.organization===org.research_id))continue;
  if(Date.now()-started>budgetMs){report.sections.push({key:'budget',state:'partial'});break}
  try{
   if(!await page.getByTestId('app-header').count())await page.goto(ORIGIN+'/pickpoints',{waitUntil:'domcontentloaded',timeout:45000});
   await selectOrganization(page,org.name_exact,{pointIds:org.points.map(p=>p.wb_point_id),allPointIds:registry.flatMap(o=>o.points.map(p=>p.wb_point_id))});
  }catch(e){const state=e.code||'organization_unavailable';report.sections.push({key:org.research_id,state,...(e.diagnostic?{diagnostic:e.diagnostic}:{})});onProgress(report);if(state==='wb_page_not_ready'){report.state='unavailable';return report}if(['blocked','authentication_required'].includes(state)){report.state=state;return report}continue}
  for(const section of sections.filter(x=>categories.includes(x.key)&&(phase==='inventory'?(x.key==='hanging'&&x.state==='to-hold'):phase==='secondary'?!(x.key==='hanging'&&x.state==='to-hold'):false))){
   if(Date.now()-started>budgetMs){report.sections.push({key:'budget:goods',state:'partial'});break}
   report.current={organization:org.research_id,section:section.key,state:section.state,step:'opening_section'};onProgress(report);
   try{
    await navigate(page,ORIGIN+section.path,section.heading,org.name_exact);
    if(section.state!=='to-hold'){
     await page.getByRole('button',{name:section.tab,exact:true}).click();
     await sleep(400);await pageReady(page,section.heading);
    }
    await page.waitForFunction(()=>/Товаров\s*\d|Нет товаров/.test(document.body?.innerText||''),null,{timeout:20000});
    const groupScan=await scanVirtual(page,page.locator('body'),extractPointGroups);
    const groups=groupScan.rows;
    const proof=await page.locator('body').evaluate(readGoodsScopeProof);
    const absentConfirmed=confirmsAbsentPoints(proof,groupScan,org);
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
     if(group?.count>0)result=await collectPoint(page,point.wb_point_id,section);
     const complete=groupScan.complete&&result.complete&&(!group||result.rows.length===group.count);
     const rows=observationRows(result.rows,scope);
     const saved=await saveScope({...scope,scope:`wb:${org.research_id}:${point.wb_point_id}:${section.key}:${section.state}`,rows,complete,
       status:complete?'ok':'partial',expected_count:group?.count||0,finished_at:stamp()});
     sectionComplete&&=complete&&saved.complete!==false;
     report.rows+=rows.length;checkedPoints.add(org.research_id+':'+point.wb_point_id);report.checked_points=checkedPoints.size;onProgress(report);
    }
    report.sections.push({key:org.research_id+':'+section.key+':'+section.state,state:sectionComplete?'ok':'partial'});
   }catch(e){const diagnostic=await page.locator('body').evaluate(readOrganizationEvidence).catch(()=>({}));await closeDrawers(page).catch(()=>{});const state=e.code||'unavailable';report.sections.push({key:org.research_id+':'+section.key+':'+section.state,state,errorType:e.name,message:String(e.message||'').split('\n')[0].slice(0,200),diagnostic});onProgress(report);
    await saveScope({scope:`wb:${org.research_id}:all:${section.key}`,organization:org.research_id,key:section.key,status:state,complete:false,rows:[]}).catch(()=>{});
    if(['blocked','authentication_required'].includes(state)){report.state=state;return report}
   }
  }
  if(phase==='inventory'&&categories.includes('tickets'))for(const namespace of ['legacy','new'])for(const point of org.points){
   report.current={organization:org.research_id,point:point.wb_point_id,section:'tickets',namespace,step:'reading_tickets'};onProgress(report);
   if(Date.now()-started>budgetMs)break;
   const scope=`wb:${org.research_id}:${point.wb_point_id}:tickets:${namespace}`;
   try{
    await navigate(page,ORIGIN+(namespace==='legacy'?'/tickets':'/tickets/new-tickets'),'Тикеты',org.name_exact);
    const search=page.getByPlaceholder('Поиск',{exact:true}).filter({visible:true}).last();if(await search.count())await search.fill('',{timeout:5000});
    await chooseTicketPoint(page,point.wb_point_id);
    await sleep(400);
    const list=await scanVirtual(page,page.locator('body'),extractTicketRows);
    const found=list.rows.filter(x=>x.point===point.wb_point_id);
    const cacheFor=row=>tickets.find(x=>x.organization_research_id===org.research_id&&x.namespace===namespace&&x.ticket_number===row.number);
    found.sort((a,b)=>Date.parse(cacheFor(a)?.last_attempt_at||'1970-01-01')-Date.parse(cacheFor(b)?.last_attempt_at||'1970-01-01'));
    const saved=[];let detailsComplete=true;
    for(const row of found){
     if(Date.now()-started>budgetMs){detailsComplete=false;break}
     const ticket={ticket_number:row.number,status:row.status,title:row.title,created_local:row.created_local,
      namespace,wb_point_id:point.wb_point_id,organization_research_id:org.research_id};
     const cached=tickets.find(x=>x.organization_research_id===org.research_id&&x.namespace===namespace&&x.ticket_number===row.number);
     if(ticketNeedsDetail(row,cached)){detailQueue.push({organization:org.research_id,point:point.wb_point_id,namespace,row,cached,ticket});report.pending_dialogues=detailQueue.length;}
     saved.push(ticket);report.tickets++;
     if(saved.length){await saveScope({scope,organization:org.research_id,point:point.wb_point_id,key:'tickets',namespace,tickets:saved.splice(0),complete:false,status:'running'});onProgress(report)}
    }
    if(!found.length&&!/Нет данных|Нет обращений|Нет тикетов/.test(await page.locator('body').innerText()))throw new WBReadError('ticket_list_not_mapped');
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
    await navigate(page,ORIGIN+(namespace==='legacy'?'/tickets':'/tickets/new-tickets'),'Тикеты',org.name_exact);
    const search=page.getByPlaceholder('Поиск',{exact:true}).filter({visible:true}).last();if(await search.count())await search.fill('',{timeout:5000});
    await chooseTicketPoint(page,point.wb_point_id);
    const closed=row=>/Реш[её]н|Закрыт|Отмен/i.test(row.status||'')?1:0;
    pending.sort((a,b)=>closed(a.row)-closed(b.row)||Date.parse(a.cached?.last_attempt_at||'1970-01-01')-Date.parse(b.cached?.last_attempt_at||'1970-01-01'));
    for(const task of pending){
     if(Date.now()-started>budgetMs){complete=false;break}
     const ticket={...task.ticket};
     try{
      await closeDrawers(page).catch(()=>{});await page.keyboard.press('Escape');
      const search=page.getByPlaceholder('Поиск',{exact:true}).filter({visible:true}).last();await search.fill(ticket.ticket_number,{timeout:5000});await sleep(400);
      Object.assign(ticket,await ticketDetail(page,task.row));
      if(!ticket.history_complete){complete=false;failed++}
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
 report.state=report.sections.some(x=>x.state!=='ok')?'partial':'ok';report.finished_at=stamp();return report;
}
