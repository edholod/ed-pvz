// Read-only WB dispute page reconnaissance for the existing Playwright browser.
// No network interception, ticket submission, bypasses or assumptions about WB's internal API.
export const WB_DISPUTE_SECTIONS = Object.freeze([
  {key:'brak',category:'Брак',url:'https://my-pvz.wb.ru/defects/to-hold'},
  {key:'podmena',category:'Подмена',url:'https://my-pvz.wb.ru/replace-goods/to-hold'},
  {key:'podmena_withheld',category:'Подмена',url:'https://my-pvz.wb.ru/replace-goods/withheld'},
  {key:'podmena_paid',category:'Подмена',url:'https://my-pvz.wb.ru/replace-goods/paid'},
  {key:'hanging',category:'Зависший',url:'https://my-pvz.wb.ru/hanging-goods/to-hold'},
  {key:'violations',category:'Штраф',url:'https://my-pvz.wb.ru/violations'},
  {key:'tickets',category:'Тикет',url:'https://my-pvz.wb.ru/tickets'}
]);
export function classifyWBPage({url,bodyText='',headings=[]}){
  const u=new URL(url);
  if(u.origin!=='https://my-pvz.wb.ru')return 'outside_wb';
  if(/login|auth|signin/i.test(u.pathname))return 'authentication_required';
  if(/verify you are human|checking your browser|unusual traffic|automated traffic|подтвердите.{0,30}(человек|робот)/i.test(bodyText))return 'blocked';
  if(/раздел недоступен/i.test(bodyText))return 'access_denied';
  if(!headings.length)return 'unverified_layout';
  return 'page_visible';
}
export async function inspectWBDisputePages(page,{onPage=()=>{}}={}){
  const results=[];
  for(const section of WB_DISPUTE_SECTIONS){
    const item={key:section.key,category:section.category,url:section.url,checkedAt:new Date().toISOString(),state:'unavailable'};
    try{
      await page.goto(section.url,{waitUntil:'domcontentloaded',timeout:45000});
      const snapshot=await page.evaluate(()=>({
        url:location.href,
        headings:[...document.querySelectorAll('h1,h2')].map(e=>(e.textContent||'').trim()).filter(Boolean).slice(0,15),
        bodyText:(document.body?.innerText||'').slice(0,15000),
        imageCount:document.images.length
      }));
      item.state=classifyWBPage(snapshot);
      item.currentUrl=snapshot.url;
      item.headings=snapshot.headings;
      item.imageCount=snapshot.imageCount;
      // Never store raw DOM or text: may contain personal or financial information.
    }catch(e){item.state=e?.name==='TimeoutError'?'timeout':'unavailable'}
    results.push(item);onPage(item);
    if(item.state==='blocked'||item.state==='authentication_required')break;
  }
  return results;
}

// Only extract rows with a stable, explicit WB identifier. Never infer an ID from a
// barcode, list index or a rendered label: those can be duplicated across PVZ.
export function normalizeDisputeRows(rows,section,pointId){
  if(!pointId || !/^\d{4,12}$/.test(String(pointId))) return [];
  const seen=new Set();
  return rows.flatMap(row=>{
    const id=String(row.eventId||'').trim();
    if(!id || id.length>128 || seen.has(id))return [];
    seen.add(id);
    const amount=row.amount===null||row.amount===undefined?null:Number(row.amount);
    return [{source_namespace:'wb:'+section.key,source_event_id:id,category:section.category,
      wb_point_id:String(pointId),barcode:String(row.barcode||'').slice(0,128)||null,
      title:String(row.title||'').slice(0,500)||null,amount:Number.isFinite(amount)?amount:null,
      observed_at:new Date().toISOString(),provenance:'wb_browser_read_only'}];
  });
}

