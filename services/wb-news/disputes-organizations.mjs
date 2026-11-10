const ORIGIN='https://my-pvz.wb.ru';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function normalizeOrganization(value){return String(value||'').normalize('NFKC').replace(/[«»"“”„]/g,'').replace(/\s+/gu,' ').trim().toLocaleLowerCase('ru')}
export function organizationPattern(name){
 const words=normalizeOrganization(name).split(' ').filter(Boolean);
 return new RegExp(words.map(word=>word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('[\\s«»"“”„]*'),'i');
}
export function organizationLabelMatches(value,name){
 const expected=normalizeOrganization(name);
 return String(value||'').split(/\r?\n/).some(line=>normalizeOrganization(line)===expected)||
  new RegExp('^'+organizationPattern(name).source+'(?:\\s+(?:Управляющий|Менеджер|Собственник|Владелец))?$','iu').test(normalizeOrganization(value));
}
// Serializable, read-only rendered DOM evidence. Never reads cookies or storage.
export function readOrganizationEvidence(root){
 const text=element=>element?.innerText??element?.textContent??'';
 const header=root.querySelector('[data-testid="app-header"]');
 const selected=[...root.querySelectorAll('input:checked,[aria-selected="true"],[aria-checked="true"],[data-state="checked"]')].flatMap(el=>{
  const label=el.tagName==='INPUT'?(el.closest('label')||root.querySelector('label[for="'+el.id.replace(/[^a-zA-Z0-9_-]/g,'')+'"]')):el;
  return label?[text(label),...[...label.querySelectorAll('span,p')].map(text)]:[];
 }).filter(Boolean);
 const pointIds=[...new Set([...text(root).matchAll(/\bID\s+(\d{4,12})\b/g)].map(m=>m[1]))];
 const options=[...root.querySelectorAll('label,[role="option"],[role="radio"]')].filter(el=>typeof el.getClientRects!=='function'||el.getClientRects().length>0).map(text).map(s=>s.trim()).filter(s=>/^(ИП|ООО|АО|ПАО)\s/.test(s)).slice(0,30);
 const doc=root.ownerDocument||root;
 const controls=[...root.querySelectorAll('button,[aria-expanded]')].filter(el=>typeof el.getClientRects!=='function'||el.getClientRects().length>0).slice(0,40).map(el=>({tag:el.tagName,text:text(el).trim().slice(0,80),label:el.getAttribute('aria-label'),title:el.getAttribute('title'),expanded:el.getAttribute('aria-expanded'),testId:el.getAttribute('data-testid')}));
 const forms=[...root.querySelectorAll('input,select')].slice(0,30).map(el=>({tag:el.tagName,placeholder:el.getAttribute('placeholder'),label:el.getAttribute('aria-label'),testId:el.getAttribute('data-testid')}));
 const dialogs=[...root.querySelectorAll('[role="dialog"]')].slice(-2).map(el=>({text:text(el).slice(0,2000),paragraphs:[...el.querySelectorAll('p')].slice(0,20).map(text)}));
 return {header:text(header).slice(0,1200),selected:selected.map(s=>s.slice(0,500)).slice(0,20),pointIds,options,headings:[...root.querySelectorAll('h1,h2,[role="heading"]')].map(text).slice(0,8),controls,forms,dialogs,page:{path:doc.location?.pathname||'',title:doc.title||'',readyState:doc.readyState||'',textSample:text(root).trim().slice(0,600),textTail:text(root).trim().slice(-1800)}};
}
export function verifyOrganization(evidence,name,{pointIds=[],allPointIds=[]}={}){
 const same=value=>organizationLabelMatches(value,name);
 const legalLine=String(evidence.header||'').split(/\r?\n/).some(same);
 if(legalLine||evidence.selected.some(same))return true;
 // Known PVZ identifiers are disjoint between the registered organizations.
 // Never use IDs from unselected organization options as active-point evidence.
 if(evidence.options.length)return false;
 const knownVisible=evidence.pointIds.filter(id=>allPointIds.includes(id));
 return knownVisible.length>0&&knownVisible.some(id=>pointIds.includes(id))&&knownVisible.every(id=>pointIds.includes(id));
}
export class OrganizationSelectionError extends Error{
 constructor(code,diagnostic){super(code);this.code=code;this.diagnostic=diagnostic}
}
export async function selectOrganization(page,name,context={}){
 const inspect=async()=>{
  const url=new URL(page.url());
  let body=await page.locator('body').innerText();
  if(url.origin!==ORIGIN||/\/(login|auth|signin)(\/|$)/i.test(url.pathname)||/Отправить код/.test(body))throw new OrganizationSelectionError('authentication_required');
  if(/verify you are human|checking your browser|unusual traffic|подтвердите.{0,30}(человек|робот)/i.test(body))throw new OrganizationSelectionError('blocked');
  let evidence=await page.locator('body').evaluate(readOrganizationEvidence);
  if(!evidence.header&&!evidence.headings.length&&!evidence.options.length&&!/Выберите организацию/.test(body)){
   // domcontentloaded only means the JS bundle was downloaded, not that WB mounted.
   await page.waitForFunction(()=>document.querySelector('[data-testid="app-header"]')?.innerText.trim()||document.querySelector('h1,h2,[role="heading"]')?.textContent.trim()||/Выберите организацию|Отправить код|verify you are human|checking your browser/i.test(document.body?.innerText||''),null,{timeout:60000}).catch(()=>{});
   body=await page.locator('body').innerText();
   if(/\/(login|auth|signin)(\/|$)/i.test(new URL(page.url()).pathname)||/Отправить код/.test(body))throw new OrganizationSelectionError('authentication_required');
   if(/verify you are human|checking your browser|unusual traffic/i.test(body))throw new OrganizationSelectionError('blocked');
  }
  evidence=await page.locator('body').evaluate(readOrganizationEvidence);
  if(!evidence.header&&!evidence.headings.length&&!evidence.options.length&&!/Выберите организацию/.test(body))throw new OrganizationSelectionError('wb_page_not_ready',evidence);
  return evidence;
 };
 let evidence=await inspect();
 const verified=()=>verifyOrganization(evidence,name,context);
 if(verified())return;
 const pattern=organizationPattern(name);
 let clicked=false;const attempts=[];
 async function chooseVisible(){
  // A radio input often has no text; click its label, including portalled labels.
  for(const candidate of [page.locator('label,[role="option"],[role="radio"]').filter({hasText:pattern}),page.getByText(pattern)]){
   for(let i=0,n=Math.min(await candidate.count(),20);i<n;i++){
    const option=candidate.nth(i);if(!await option.isVisible()||!organizationLabelMatches(await option.innerText(),name))continue;
    await option.click({timeout:4000});clicked=true;
    for(let pass=0;pass<12;pass++){
     await pause(250);evidence=await inspect();if(verified())return true;
    }
    // A closed picker can expose only the PVZ address. Verify against the point list.
    if(context.pointIds?.length){
     await page.goto(ORIGIN+'/pickpoints',{waitUntil:'domcontentloaded',timeout:45000});
     for(let pass=0;pass<12;pass++){await pause(250);evidence=await inspect();if(verified())return true}
    }
    throw new OrganizationSelectionError('organization_selection_unverified',{...evidence,attempts});
   }
  }return false;
 }
 if(await chooseVisible())return;
 // Only semantic picker controls; never enumerate unrelated profile/logout buttons.
 const triggers=[page.getByTestId('app-header').locator('[aria-expanded]').filter({hasText:/^(ИП|ООО|АО|ПАО)\s/}),page.getByRole('button',{name:/организац|компани|сменить\s+(ПВЗ|пункт)/i}),page.locator('[role="combobox"][aria-label*="организац" i],[data-testid*="organization"][aria-expanded]')];
 if(!await page.getByTestId('app-header').count()&&/Выберите организацию/.test(await page.locator('body').innerText()))triggers.push(page.locator('[aria-expanded]'));
 for(const group of triggers){
  const count=Math.min(await group.count(),5);
  for(let i=0;i<count;i++){
   const trigger=group.nth(i);if(!await trigger.isVisible())continue;
   const attempt={trigger:(await trigger.innerText()).slice(0,120),before:await trigger.getAttribute('aria-expanded')};attempts.push(attempt);
   try{await trigger.click({timeout:8000})}catch(error){attempt.error=error.name||'click_failed';continue}
   // Rendering a portal/list can take longer than its opening animation on the server.
   await page.getByText(pattern).first().waitFor({state:'visible',timeout:12000}).catch(()=>{});
   evidence=await inspect();attempt.after=await trigger.getAttribute('aria-expanded');attempt.options=evidence.options;
   if(await chooseVisible())return;
   // Some account menus expose the organization picker in a second step.
   const change=page.getByText(/^(Сменить|Выбрать|Изменить)\s+организацию$/i);
   if(await change.count()&&await change.first().isVisible()){
    await change.first().click({timeout:4000});await page.getByText(pattern).first().waitFor({state:'visible',timeout:12000}).catch(()=>{});if(await chooseVisible())return;
   }
   if(await trigger.getAttribute('aria-expanded')==='true')await trigger.click({timeout:2500}).catch(()=>{});
  }
 }
 await page.goto(ORIGIN+'/pickpoints',{waitUntil:'domcontentloaded',timeout:45000});
 await pause(500);evidence=await inspect();if(verified()||await chooseVisible())return;
 throw new OrganizationSelectionError(clicked?'organization_selection_unverified':'organization_option_missing',{...evidence,attempts});
}
