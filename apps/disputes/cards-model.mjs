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
