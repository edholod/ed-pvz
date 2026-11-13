(function(){'use strict';
function init(){
 const photo=document.getElementById('addPhoto'),dispute=document.getElementById('attachDispute');
 if(!photo||!dispute||document.getElementById('attachMenu'))return;
 const composer=photo.closest('.composer');if(!composer)return;
 const button=document.createElement('button');button.id='attachMenu';button.type='button';button.className='chat-attach-button';button.title='Прикрепить';button.setAttribute('aria-label','Прикрепить фото или удержание');button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m20.5 11.5-8.7 8.7a5.5 5.5 0 0 1-7.8-7.8L14.4 2a3.7 3.7 0 0 1 5.2 5.2L9.2 17.6a1.9 1.9 0 0 1-2.7-2.7l9-9"/></svg>';
 composer.insertBefore(button,dispute);
 photo.style.display='none';dispute.style.display='none';
 const overlay=document.createElement('div');overlay.className='chat-attach-overlay';overlay.hidden=true;
 const sheet=document.createElement('div');sheet.className='chat-attach-sheet';sheet.setAttribute('role','dialog');sheet.setAttribute('aria-modal','true');sheet.setAttribute('aria-label','Прикрепить');
 const heading=document.createElement('div');heading.className='chat-attach-heading';heading.textContent='Прикрепить';
 const photoOption=document.createElement('button');photoOption.type='button';photoOption.className='chat-attach-option';photoOption.innerHTML='<span class="chat-attach-icon"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m4 18 5-5 4 4 3-3 4 4"/></svg></span><span><strong>Фото</strong><small>Галерея или камера</small></span>';
 const disputeOption=document.createElement('button');disputeOption.type='button';disputeOption.className='chat-attach-option';disputeOption.innerHTML='<span class="chat-attach-icon"><svg viewBox="0 0 24 24"><path d="M7 3h8l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM14 3v5h5M9 13h6M9 17h6"/></svg></span><span><strong>Удержания</strong><small>Зависшие, браки и подмены</small></span>';
 const locationOption=document.createElement('button');locationOption.type='button';locationOption.className='chat-attach-option';locationOption.innerHTML='<span class="chat-attach-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg></span><span><strong>Геолокация</strong><small>Отправить своё местоположение</small></span>';
 const qrOption=document.createElement('button');qrOption.type='button';qrOption.className='chat-attach-option';qrOption.innerHTML='<span class="chat-attach-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM19 14h2v2h-2zM14 19h2v2h-2zM19 19h2v2h-2z"/></svg></span><span><strong>QR-код</strong><small>Создать и отправить QR-код</small></span>';
 const taskOption=document.createElement('button');taskOption.type='button';taskOption.className='chat-attach-option';taskOption.innerHTML='<span class="chat-attach-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="3"/><path d="m8 12 3 3 5-6"/></svg></span><span><strong>Задача</strong><small>Выбрать или создать задачу</small></span>';
 const cancel=document.createElement('button');cancel.type='button';cancel.className='chat-attach-cancel';cancel.textContent='Отмена';
 sheet.append(heading,photoOption,disputeOption,locationOption,qrOption,taskOption,cancel);overlay.append(sheet);document.body.append(overlay);
 const close=()=>{overlay.hidden=true};button.onclick=()=>{disputeOption.hidden=dispute.hidden;overlay.hidden=false};
 photoOption.onclick=()=>{close();photo.click()};disputeOption.onclick=()=>{close();dispute.click()};locationOption.onclick=()=>{close();window.EdPVZLocationAttachment?.open()};qrOption.onclick=()=>{close();window.EdPVZQRAttachment?.open()};taskOption.onclick=()=>{close();window.EdPVZTaskAttachment?.open()};
 cancel.onclick=close;overlay.onclick=e=>{if(e.target===overlay)close()};
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!overlay.hidden)close()});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();