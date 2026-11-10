(function(){'use strict';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=id=>document.getElementById(id),date=s=>s?new Date(s).toLocaleString('ru-RU'):'ещё не проверено';
const labels={organization_option_missing:'Не найден выбор организации в WB',organization_selection_unverified:'WB не подтвердил выбор организации',organization_header_missing:'Не удалось открыть кабинет организации',interrupted:'Проверка прервана — будет повторена',ok:'Обновлено',partial:'Обновлено частично',running:'Идёт обновление',authentication_required:'Нужен вход в WB',blocked:'WB остановил автоматический доступ',waiting:'Ожидает проверки',unavailable:'Источник временно недоступен',layout_changed:'Страница WB изменилась',role_restricted:'Недоступно для этой роли',detail_unavailable:'Не удалось прочитать переписку'};
window.EdPVZDisputesSync={create({rest,account,onRows}){
 let observations=[],tickets=[],busy=false,timer=null,registry=[],points=[];
 async function all(path){const rows=[];for(let offset=0;offset<100000;offset+=1000){const batch=await rest(path+(path.includes('?')?'&':'?')+'limit=1000&offset='+offset);rows.push(...batch);if(batch.length<1000)return rows}throw Error('Список слишком велик для одного просмотра')}
 function rows(){return observations.map(o=>{
  const point=points.find(p=>p.wb_point_id===o.wb_point_id),org=registry.find(p=>p.research_id===o.organization_research_id);
  const matching=tickets.filter(t=>t.organization_research_id===o.organization_research_id&&t.wb_point_id===o.wb_point_id&&t.ticket_number===o.raw?.ticket_number);
  const linked=matching.find(t=>t.namespace==='legacy')||matching[0];
  return {...o,id:'wb:'+o.id,automatic:true,owner_name:org?.name_exact||o.organization_research_id,point_name:point?.address_observed||o.wb_point_id,
   point_id:o.wb_point_id,reason:o.raw?.reason||'',ticket:o.raw?.ticket_number||'',status:linked?.needs_attention?'Нужен ответ':linked?'Ждём WB':'Новое',
   withheld_on:null,refunded:o.wb_state==='paid'?o.amount:0,deadline:null,ticket_id:linked?.id,
   source:'WB',notes:o.raw?.identity_warning||''};
 })}
 function publish(){onRows(rows());renderTickets()}
 function renderTickets(){
  const org=$('org-filter').value,point=$('point-filter').value,attention=$('ticket-attention').checked;
  const filtered=tickets.filter(t=>(!org||t.organization_research_id===org)&&(!point||t.wb_point_id===point)&&(!attention||t.needs_attention));
  $('ticket-count').textContent=tickets.length+' тикетов';
  $('wb-tickets').innerHTML=filtered.map(t=>'<article class="case"><span class="pill">'+esc(t.namespace==='new'?'Обращение':'Тикет')+' №'+esc(t.ticket_number)+'</span> <span class="pill">'+esc(t.status||'Статус не прочитан')+'</span>'+(t.needs_attention?' <span class="pill">Нужен ответ</span>':'')+'<h3>'+esc(t.title||'Обращение WB')+'</h3><p class="meta">ПВЗ '+esc(t.wb_point_id)+' · '+esc(registry.find(o=>o.research_id===t.organization_research_id)?.name_exact||'')+'</p><p class="meta">Последний ответ WB: '+esc(date(t.last_reply_at))+'</p><p class="meta">Переписка: '+(t.history_complete?'прочитана · '+esc(date(t.last_checked_at)):'ещё не прочитана')+'</p>'+(t.detail_error?'<p class="meta">'+esc(labels[t.detail_error]||'Не удалось обновить подробности')+'</p>':'')+'<button data-wb-ticket="'+esc(t.id)+'">Переписка</button></article>').join('')||'<div class="empty">Тикеты появятся после чтения кабинета WB.</div>';
 }
 async function openTicket(id){
  const t=tickets.find(x=>x.id===id);if(!t)return;
  $('wb-detail-title').textContent=(t.namespace==='new'?'Обращение':'Тикет')+' №'+t.ticket_number;
  $('wb-detail-body').textContent='Загрузка переписки…';$('wb-detail').showModal();
  try{
   const messages=await all('edpvz_dispute_ticket_messages?select=*&ticket_id=eq.'+encodeURIComponent(id)+'&is_current=eq.true&order=sequence_number.asc,id.asc');
   $('wb-detail-body').innerHTML=messages.length?messages.map(m=>'<article class="case" style="margin:10px 0"><strong>'+esc(({wb_support:'Ответ WB',user:'Ваше сообщение',system:'Система',unknown:'Автор не определён'})[m.author_role])+'</strong><p class="meta">'+esc(m.raw?.date_local||date(m.message_at))+'</p><p style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(m.message_text)+'</p>'+(m.raw?.attachments||[]).filter(a=>/^https:\/\//.test(a)).map((a,i)=>'<p><a href="'+esc(a)+'" target="_blank" rel="noopener noreferrer">Вложение '+(i+1)+'</a></p>').join('')+'</article>').join(''):'Переписка пока не получена. Статус в списке не означает, что сообщения уже загружены.';
  }catch(e){$('wb-detail-body').textContent='Не удалось загрузить переписку: '+e.message}
 }
 function card(x){
  return '<article class="case">'+(x.photo_url?'<img loading="lazy" referrerpolicy="no-referrer" src="'+esc(x.photo_url)+'" alt="'+esc(x.title||'Фото товара')+'">':'')+'<span class="pill">'+esc(x.category)+'</span> <span class="pill">'+esc(x.status)+'</span><h3>'+esc(x.title||'Товар WB')+'</h3><p>ШК '+esc(x.barcode)+'</p><div class="amount">'+esc(x.amount===null?'Сумма не указана':new Intl.NumberFormat('ru-RU').format(Number(x.amount))+' ₽')+'</div><p class="meta">'+esc(x.owner_name)+' · '+esc(x.point_name)+'</p><p class="meta">'+esc(x.reason).slice(0,500)+'</p><p class="meta">'+esc(x.raw?.date_label||'Дата в WB не указана')+' · Тикет: '+esc(x.ticket||'не связан')+'</p><p class="meta">Проверено: '+esc(date(x.last_seen_at||x.observed_at))+'</p>'+(x.identity_kind==='observed_card'?'<p class="meta">Сохранено по карточке WB. ID события не подтверждён.</p>':'')+(x.is_current===false?'<p class="meta">Ранее наблюдалось; сохранено в истории.</p>':'')+(x.ticket_id?'<button data-wb-ticket="'+esc(x.ticket_id)+'">Переписка</button>':'')+'</article>';
 }
 async function load(orgs,pp){
  if(busy||!account.signedIn||account.user?.id!=='0f75065b-2b26-4a87-bf26-005f5a2284d4')return;
  busy=true;registry=orgs||registry;points=pp||points;
  try{
   const state=$('wb-state').value,history=$('wb-history').checked;
   const results=await Promise.all([
    all('edpvz_dispute_observations?select=*&wb_state=eq.'+encodeURIComponent(state)+(history?'':'&is_current=eq.true')+'&order=id.asc'),
    all('edpvz_dispute_tickets?select=*&order=id.asc'),
    rest('edpvz_dispute_sync_control?select=last_state,next_due_at,last_report,updated_at'),
    all('edpvz_dispute_sync_scopes?select=scope,state,last_success,last_error&order=scope.asc')
   ]);
   observations=results[0];tickets=results[1];const control=results[2][0],scopes=results[3].filter(x=>!/^wb:all:/.test(x.scope));
   $('wb-sync-state').textContent=labels[control?.last_state]||'Ожидает первого чтения';
   const r=control?.last_report||{};
   $('wb-sync-description').textContent='Проверка каждые 3 часа. '+(control?.last_state==='authentication_required'?'Нужно завершить вход на сервере WB. ':'')+'Товарных карточек в последнем обходе: '+(r.rows||0)+', тикетов: '+(r.tickets||0)+'. Следующая проверка: '+(control?.next_due_at?date(control.next_due_at):'после подключения WB')+'.';
   $('sync-scopes').innerHTML='<details><summary>Проверки по ПВЗ: '+scopes.filter(x=>x.state==='ok').length+' успешных из '+scopes.length+'</summary>'+scopes.map(s=>'<p>'+esc(s.scope)+' — '+esc(labels[s.state]||s.state)+(s.last_success?' · '+esc(date(s.last_success)):'')+'</p>').join('')+'</details>';
   const organizationErrors=(r.sections||[]).filter(section=>section.state!=='ok'&&section.state!=='running');
   if(organizationErrors.length)$('sync-scopes').innerHTML+='<details open><summary>Участки, которые не удалось обновить: '+organizationErrors.length+'</summary>'+organizationErrors.map(section=>'<p>'+esc(registry.find(org=>org.research_id===section.key)?.name_exact||section.key)+' — '+esc(labels[section.state]||'Не удалось прочитать раздел WB')+'</p>').join('')+'</details>';
   if(control?.last_state==='authentication_required')$('wb-sync-description').textContent='WB завершил вход. Загрузка остановлена до повторного входа на странице «Подключение WB». Полученные ранее карточки сохранены.';
   publish();
  }catch(e){$('sync-scopes').textContent='Не удалось обновить данные: '+e.message}
  finally{busy=false}
 }
 $('wb-sync-now').onclick=async()=>{
  $('wb-sync-now').disabled=true;
  try{
   const session=await account.ensure();
   const response=await fetch('https://duerixyhzapotoeclggz.supabase.co/functions/v1/edpvz-disputes-ingest',{method:'POST',headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({kind:'request_sync'})});
   if(!response.ok)throw Error('Сервер: '+response.status);
   $('wb-sync-description').textContent='Обновление запрошено. Сервер начнёт проверку после пробуждения и завершения текущей операции.';
   fetch('https://ed-pvz-wb-login.onrender.com/healthz',{mode:'no-cors',credentials:'omit'}).catch(()=>{});
  }catch(e){$('wb-sync-description').textContent='Не удалось запросить обновление: '+e.message}
  finally{$('wb-sync-now').disabled=false}
 };
 ['wb-state','wb-history'].forEach(id=>$(id).addEventListener('change',()=>load()));
 ['org-filter','point-filter','ticket-attention'].forEach(id=>$(id).addEventListener('change',renderTickets));
 document.addEventListener('click',event=>{const b=event.target.closest('[data-wb-ticket]');if(b)openTicket(b.dataset.wbTicket)});
 $('wb-detail-close').onclick=()=>$('wb-detail').close();
 function start(){if(!timer)timer=setInterval(()=>{if(document.visibilityState!=='hidden')load()},15000)}
 function stop(){clearInterval(timer);timer=null;observations=[];tickets=[];$('wb-tickets').innerHTML='';if($('wb-detail').open)$('wb-detail').close();publish()}
 return {load,card,start,stop};
}};
})();
