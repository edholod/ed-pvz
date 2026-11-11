export const STATUSES=['Обращение не создано','Тикет в работе','Оспаривание отклонено по тех. причинам','Вина сотрудника','Успешно оспорено'];
export const STATUS_CLASSES=['new','working','technical','employee','success'];
export const FIELDS=['sticker','cost','withholding_date','withholding_type','employee_fault','employee_fault_date','ticket_number','comment'];
export const blankNote=()=>({status:STATUSES[0],sticker:'',cost:null,withholding_date:null,withholding_type:'',employee_fault:'',employee_fault_date:null,ticket_number:'',comment:'',revision:0});
export function eligible(row){return row.is_current!==false&&row.wb_state==='to-hold'&&row.raw?.collection_since==='2026-10-01'}
export function validateNote(input){
 const out={};if(!STATUSES.includes(input.status))throw Error('Выбери статус из списка');out.status=input.status;
 for(const key of ['sticker','withholding_type','employee_fault','ticket_number','comment']){out[key]=String(input[key]??'').trim();if(out[key].length>(key==='comment'?20000:200))throw Error('Слишком длинное поле: '+key)}
 const cost=String(input.cost??'').trim().replace(',','.');if(cost&&!/^\d{1,12}(?:\.\d{1,2})?$/.test(cost))throw Error('Стоимость: укажи положительное число, до двух знаков после запятой');out.cost=cost?cost:null;
 for(const key of ['withholding_date','employee_fault_date']){const date=input[key]||null;if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date))throw Error('Проверь дату');out[key]=date}
 return out;
}
export async function photoPath(url){
 if(!/^https:\/\/[^/?]+\.(wbbasket|wb|wildberries)\.ru\/[^?]+\.(webp|jpg|jpeg|png)$/.test(url||''))return null;
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(url));const hash=[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');return 'assets/wb-disputes/'+hash+'.'+url.split('.').pop();
}
export function csvCell(value){let text=String(value??'');if(/^[=+@-]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"'}

export function initialNote(row){
 const n=blankNote(),m=String(row.raw?.date_label||'').match(/(?:^|\n)до\s+(\d{2})\.(\d{2})\.(\d{4})/i);
 return {...n,sticker:row.barcode||'',cost:row.amount??null,withholding_date:m?`${m[3]}-${m[2]}-${m[1]}`:null,withholding_type:[row.category,row.raw?.reason?.slice(0,150)].filter(Boolean).join(': ')};
}

export function visibleObservations(rows){
 const current=rows.filter(eligible),family=row=>JSON.stringify([row.organization_research_id,row.wb_point_id,row.category,row.barcode,row.raw?.group||'',row.raw?.occurrence||1]);
 const upgraded=new Set(current.filter(row=>row.source_event_id?.startsWith('observed:v2:')).map(family));
 return current.filter(row=>row.source_event_id?.startsWith('observed:v2:')||!upgraded.has(family(row)));
}

export function mapNotes(rows,notes){
 const result=new Map(notes.map(note=>[note.observation_id,note]));
 const family=row=>JSON.stringify([row.organization_research_id,row.wb_point_id,row.category,row.barcode,row.raw?.group||'',row.raw?.occurrence||1]);
 for(const row of rows){if(result.has(row.id))continue;const matches=notes.filter(note=>note.source&&family(note.source)===family(row));if(matches.length===1)result.set(row.id,{...matches[0],canonical_id:matches[0].observation_id})}
 return result;
}

export function monthKey(note){const d=String(note?.withholding_date||'');return /^\d{4}-\d{2}-\d{2}$/.test(d)?d.slice(0,7):'undated'}
export function monthLabel(key){if(key==='undated')return 'Без срока обращения';const [year,month]=key.split('-').map(Number);return new Date(Date.UTC(year,month-1,1)).toLocaleDateString('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'})}
export function monthGroups(rows,getNote){
 const groups=new Map();for(const row of rows){const key=monthKey(getNote(row.id));if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row)}
 return [...groups].sort(([a],[b])=>a==='undated'?1:b==='undated'?-1:b.localeCompare(a)).map(([key,items])=>({key,label:monthLabel(key),rows:items.sort((a,b)=>String(getNote(a.id).withholding_date||'').localeCompare(String(getNote(b.id).withholding_date||'')))}));
}

export function attachSourceTickets(rows,tickets){return rows.map(row=>{const number=String(row.raw?.ticket_number||'');if(!number)return row;const matches=tickets.filter(t=>t.ticket_number===number&&t.organization_research_id===row.organization_research_id&&String(t.wb_point_id)===String(row.wb_point_id));return {...row,wb_ticket:{number,...(matches.length===1?{status:matches[0].status,checked_at:matches[0].last_checked_at}:{status:null,checked_at:null})}}})}
export function pointCoverage(point,scopes){const required=['hanging','brak','podmena'];return required.filter(category=>scopes.some(s=>s.scope===`wb:${point.organization_research_id}:${point.wb_point_id}:${category}:to-hold`&&s.state==='ok'&&Date.parse(s.last_success)>=Date.parse('2026-11-10T11:50:36Z'))).length}
export function sourceMatches(row,filter){const exists=Boolean(row.wb_ticket?.number||row.raw?.ticket_number);return !filter||(filter==='with'&&exists)||(filter==='without'&&!exists)||(filter==='working'&&row.wb_ticket?.status==='В работе')}

export function manualHangingObservation(input, owner, organization, point, id) {
 const barcode = String(input.barcode || '').trim();
 if (!barcode || barcode.length > 200) throw Error('Укажи ШК или стикер.');
 const note = validateNote({ ...blankNote(), cost: input.cost, withholding_date: input.deadline });
 const title = String(input.title || '').trim() || 'Зависший товар';
 const reason = String(input.reason || '').trim();
 if (title.length > 200 || reason.length > 150) throw Error('Сократи название или причину удержания.');
 return {
  id, owner_id: owner, organization_research_id: organization, wb_point_id: point,
  category: 'Зависший', source_namespace: 'manual:v1', source_event_id: id,
  barcode, title, amount: note.cost, wb_state: 'to-hold', is_current: true,
  provenance: 'manual_verified_import',
  // Keep manual entries in the current dashboard without using a WB sync namespace.
  raw: {
   collection_since: '2026-10-01', group: 'Добавлено вручную', reason,
   date_label: note.withholding_date ? 'до ' + note.withholding_date.split('-').reverse().join('.') : ''
  }
 };
}
