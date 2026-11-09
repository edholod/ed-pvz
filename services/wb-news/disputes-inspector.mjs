// Read-only WB dispute page reconnaissance for the existing Playwright browser.
// No network interception, ticket submission, bypasses or assumptions about WB's internal API.
export const WB_DISPUTE_SECTIONS = Object.freeze([
  {key:'brak',category:'Брак',url:'https://my-pvz.wb.ru/defects/to-hold'},
  {key:'podmena',category:'Подмена',url:'https://my-pvz.wb.ru/replace-goods/to-hold'},
  {key:'podmena_withheld',category:'Подмена',url:'https://my-pvz.wb.ru/replace-goods/withheld'}
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
