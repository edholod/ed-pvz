import {createHash} from 'node:crypto';
export const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const hasWBCookies=state=>Boolean(state?.cookies?.some(c=>/(^|\.)(wb\.ru|wildberries\.ru)$/.test(c.domain.replace(/^\./,''))));
export function money(value){
  const text=String(value??'').replace(/[\s\u00a0\u202f₽]/g,'').replace(',','.');
  return /^-?\d+(?:\.\d{1,2})?$/.test(text)?text:null;
}
export function localDate(value){
  const m=String(value||'').match(/(\d{2})\.(\d{2})\.(\d{4}|\d{2})(?!\d)(?:[, ]+(\d{1,2}):(\d{2}))?/);
  if(!m)return null;
  const year=m[3].length===2?'20'+m[3]:m[3];
  const check=new Date(Date.UTC(Number(year),Number(m[2])-1,Number(m[1])));
  if(check.getUTCFullYear()!==Number(year)||check.getUTCMonth()!==Number(m[2])-1||check.getUTCDate()!==Number(m[1])||Number(m[4]||0)>23||Number(m[5]||0)>59)return null;
  const result=`${year}-${m[2]}-${m[1]}T${(m[4]||'00').padStart(2,'0')}:${m[5]||'00'}:00+03:00`;
  const time=Date.parse(result);return Number.isFinite(time)?new Date(time).toISOString():null;
}
export function safeImage(value){
  try{const u=new URL(value);return u.protocol==='https:'&&/(^|\.)(wbbasket\.ru|wb\.ru|wildberries\.ru)$/.test(u.hostname)&&!u.search&&!u.username?u.href:null}catch{return null}
}
export function observationRows(items,{organization,point,category,state,group='',date_range_verified=false}){
  const repeated=new Map();
  return items.map(item=>{
    const barcode=String(item.barcode||'');
    if(!/^\d{4,40}$/.test(barcode))throw Error('invalid_barcode');
    // This is an observed-card identity, explicitly not an invented native WB event ID.
    const itemGroup=item.groupLabel||group;
    const base=[organization,point,category,itemGroup,barcode];
    const hash=digest(base),occurrence=(repeated.get(hash)||0)+1;repeated.set(hash,occurrence);
    const native=item.eventId?String(item.eventId):null;
    return {organization_research_id:organization,wb_point_id:String(point),category,
      source_namespace:`browser:v1:${organization}:${point}:${category}:${state}`,
      source_event_id:native?'native:'+native:'observed:v2:'+hash+':'+occurrence,
      identity_kind:native?'native':'observed_card',wb_state:state,barcode,
      title:String(item.title||'').slice(0,500),photo_url:safeImage(item.photo),amount:money(item.amount),
      provenance:'wb_browser_read_only',raw:{reason:String(item.reason||'').slice(0,10000),
        date_label:String(item.dateLabel||''),collection_since:date_range_verified?'2026-10-01':null,ticket_number:item.ticketNumber||null,group:itemGroup,
        native_event_id:native,occurrence,identity_warning:native?null:'Идентичность события WB не подтверждена',
        amount_kind:state==='to-hold'?'expected':state==='paid'?'refund':'withholding'}};
  });
}
export function normalizeMessages(messages){
  const counts=new Map();
  return messages.map((m,index)=>{
    const text=String(m.text||'').trim();
    const role=['user','wb_support','system'].includes(m.role)?m.role:'unknown';
    const basis=[role,m.dateLocal||'',text,m.attachments||[]];
    const hash=digest(basis),n=(counts.get(hash)||0)+1;counts.set(hash,n);
    return {source_message_id:m.id?'native:'+String(m.id):'observed:'+hash+':'+n,
      author_role:role,message_text:text.slice(0,100000),message_at:localDate(m.dateLocal),
      sequence_number:index,raw:{date_local:m.dateLocal||'',author_label:m.author||'',attachments:m.attachments||[]}};
  });
}
export function appendedSupport(previous,next){
  if(!previous?.length||next.length<previous.length)return [];
  if(!previous.every((key,i)=>key===next[i]?.source_message_id))return [];
  return next.slice(previous.length).filter(m=>m.author_role==='wb_support');
}
export function ticketNeedsDetail(ticket,cached,now=Date.now()){
  if(!cached?.baseline_completed_at)return true;
  const age=now-Date.parse(cached.last_checked_at||0);
  return !/реш[её]н|закрыт|отмен[её]н/i.test(ticket.status||'')||age>7*86400000;
}

export function eligibleObservation(row){
 // An appeal deadline is not proof of the event's collection period.
 return row.wb_state==='to-hold'&&row.raw?.collection_since==='2026-10-01';
}
