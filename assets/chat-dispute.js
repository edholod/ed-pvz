(function(){'use strict';
const base='https://duerixyhzapotoeclggz.supabase.co',key='sb_publishable_fKE2S2rAz7VMa54rgO4uvQ_vyzFPwmV';
const rx=/^\[Карточка ПВЗ\] ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
function parse(body){return rx.exec(String(body||''))?.[1]||null}
async function rpc(action,id){const session=await window.EdPVZAccount.ensure();if(!session?.access_token)throw Error('Войдите в аккаунт');const r=await fetch(base+'/rest/v1/rpc/edpvz_chat_dispute',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({p_action:action,p_id:id||null})});const data=await r.json().catch(()=>null);if(!r.ok)throw Error(data?.message||'Не удалось получить карточки');return data}
const statuses=['Обращение не создано','Тикет в работе','Оспаривание отклонено по тех. причинам','Вина сотрудника','Успешно оспорено'];
const classes=['new','working','technical','employee','success'];
function card(item){const box=document.createElement('div');box.className='chat-dispute-card case '+(classes[Math.max(0,statuses.indexOf(item.status))]);
 const summary=document.createElement('div');summary.className='case-summary';
 const photo=document.createElement('div');photo.className='photo-box';
 if(item.photo_url){const img=document.createElement('img');img.src=item.photo_url;img.alt='Фото товара';img.loading='lazy';photo.append(img)}else photo.textContent='Нет фото';
 const facts=document.createElement('div');facts.className='case-facts';
 const title=document.createElement('h3');title.textContent=item.title||item.category||'Товар';
 const kind=document.createElement('div');kind.className='compact-type';kind.textContent=[item.category,item.point_name||item.point_id].filter(Boolean).join(' · ');
 const dl=document.createElement('dl');
 for(const [label,value] of [['ШК / Стикер',item.barcode||'—'],['Стоимость',item.amount!=null?Number(item.amount).toLocaleString('ru-RU')+' ₽':'—'],['Обращение до',item.deadline||'—']]){const div=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;div.append(dt,dd);dl.append(div)}
 const status=document.createElement('span');status.className='status-badge';status.textContent=item.status||statuses[0];
 facts.append(title,kind,dl,status);
 if(item.ticket){const ticket=document.createElement('div');ticket.className='wb-ticket';ticket.textContent='Тикет: '+item.ticket;facts.append(ticket)}
 summary.append(photo,facts);box.append(summary);
 if(item.comment){const note=document.createElement('div');note.className='chat-dispute-comment';const label=document.createElement('strong');label.textContent='Комментарий';const content=document.createElement('p');content.textContent=item.comment;note.append(label,content);box.append(note)}
 return box}
function render(body){const id=parse(body);if(!id)return null;const wrap=document.createElement('div');wrap.className='chat-dispute-attachment';wrap.textContent='Загрузка карточки…';rpc('read',id).then(item=>{wrap.replaceChildren();if(!item){wrap.textContent='Карточка недоступна: нет доступа или запись снята с учёта';return}wrap.append(card(item))}).catch(()=>{wrap.textContent='Не удалось загрузить карточку'});return wrap}
function attach(button,context,onSent,onError){const overlay=document.createElement('div');overlay.className='chat-dispute-overlay';overlay.hidden=true;const panel=document.createElement('section');panel.className='chat-dispute-panel';const heading=document.createElement('h3');heading.textContent='Прикрепить товар';const search=document.createElement('input');search.type='search';search.placeholder='Поиск по пункту, товару или ШК';search.setAttribute('aria-label','Поиск карточек');const list=document.createElement('div');list.className='chat-dispute-list';const cancel=document.createElement('button');cancel.type='button';cancel.className='chat-dispute-cancel';cancel.textContent='Закрыть';panel.append(heading,search,list,cancel);overlay.append(panel);document.body.append(overlay);
 let rows=[],busy=false;function close(){overlay.hidden=true}cancel.onclick=close;overlay.onclick=e=>{if(e.target===overlay)close()};
 function draw(){list.replaceChildren();const q=search.value.trim().toLocaleLowerCase('ru');const found=rows.filter(x=>[x.point_name,x.category,x.title,x.barcode,x.point_id].some(v=>String(v||'').toLocaleLowerCase('ru').includes(q)));if(!found.length){const p=document.createElement('p');p.className='chat-dispute-empty';p.textContent=rows.length?'Ничего не найдено':'Нет доступных зависших, браков или подмен';list.append(p);return}for(const item of found){const b=document.createElement('button');b.type='button';b.className='chat-dispute-choice';b.append(card(item));b.onclick=async()=>{if(busy)return;const ctx=context();if(!ctx){onError('Откройте чат');return}busy=true;b.disabled=true;try{await onSent('[Карточка ПВЗ] '+item.id);close()}catch(e){onError(e.message||String(e))}finally{busy=false;b.disabled=false}};list.append(b)}}
 search.oninput=draw;rpc('list').then(items=>{button.hidden=!items.length}).catch(()=>{button.hidden=true});button.onclick=async()=>{if(!context()){onError('Сначала откройте чат');return}overlay.hidden=false;search.value='';list.textContent='Загрузка…';try{rows=await rpc('list');draw()}catch(e){list.textContent=e.message||'Ошибка загрузки'}};
}
window.EdPVZChatDispute={attach,render,parse};
})();