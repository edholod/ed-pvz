(function(){'use strict';
const api='https://duerixyhzapotoeclggz.supabase.co/functions/v1/edpvz-chat-image';
const rx=/^\[Фото\] (https:\/\/raw\.githubusercontent\.com\/edholod\/ed-pvz\/main\/assets\/chat-images\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:jpg|webp|png))$/;
function parse(body){return rx.exec(String(body||''))?.[1]||null}
function decodeImageElement(source){
 const url=URL.createObjectURL(source);
 const image=new Image();
 return new Promise((resolve,reject)=>{
  image.onload=()=>resolve(image);
  image.onerror=()=>reject(Error('Не удалось прочитать изображение'));
  image.src=url;
 }).finally(()=>URL.revokeObjectURL(url));
}
async function compress(file){
 if(!file.size)throw Error('Камера вернула пустой файл. Сделайте снимок ещё раз.');
 const heic=/\.(heic|heif)$/i.test(file.name)||/^image\/hei[cf](?:-sequence)?$/i.test(file.type);
 const source=heic&&!file.type.startsWith('image/')?file.slice(0,file.size,'image/heic'):file;
 let decoded;
 // Safari can display HEIC in an image even when bitmap decoding fails.
 try{decoded=await decodeImageElement(source)}catch{
  if(typeof createImageBitmap==='function'){
   try{decoded=await createImageBitmap(source)}catch{}
  }
 }
 if(!decoded)throw Error(heic?'Не удалось обработать снимок HEIC. Попробуйте выбрать его из медиатеки.':'Не удалось открыть фото. Попробуйте сделать снимок ещё раз.');
 const width=decoded.naturalWidth||decoded.width;
 const height=decoded.naturalHeight||decoded.height;
 const max=1600,scale=Math.min(1,max/Math.max(width,height));
 const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
 try{canvas.getContext('2d',{alpha:false}).drawImage(decoded,0,0,canvas.width,canvas.height)}finally{decoded.close?.()}
 let blob=null;
 for(const q of [.82,.72,.6,.48]){blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',q));if(blob&&blob.size<=1700000)break}
 if(!blob||blob.size>1800000)throw Error('Не удалось достаточно сжать фото');
 return blob;
}
function render(body){const url=parse(body);if(!url)return null;const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.className='chat-photo-link';const img=document.createElement('img');img.src=url;img.alt='Фото в сообщении';img.loading='lazy';img.className='chat-photo';link.append(img);return link}
function attach(button,context,onSent,onError){
 function fileInput(){
  const input=document.createElement('input');
  input.type='file';
  input.accept='image/*';
  input.tabIndex=-1;
  input.setAttribute('aria-hidden','true');
  input.style.cssText='position:absolute;width:1px;height:1px;clip-path:inset(50%);overflow:hidden;pointer-events:none';
  return input;
 }
 const gallery=fileInput();
 const camera=fileInput();
 camera.setAttribute('capture','environment');
 button.parentElement.append(gallery,camera);
 const picker=document.createElement('div');picker.className='chat-photo-picker';picker.hidden=true;
 const heading=document.createElement('div');heading.className='chat-photo-picker-title';heading.textContent='Добавить фотографию';
 const g=document.createElement('button');g.type='button';g.innerHTML='<span class="chat-photo-option-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m4 18 5-5 4 4 3-3 4 4"/></svg></span><span><strong>Фото из галереи</strong><small>Выбрать из медиатеки</small></span>';
 const c=document.createElement('button');c.type='button';c.innerHTML='<span class="chat-photo-option-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h4l2-3h4l2 3h4v12H4z"/><circle cx="12" cy="13" r="3.2"/></svg></span><span><strong>Сделать фото</strong><small>Открыть камеру</small></span>';
 const closePicker=document.createElement('button');closePicker.type='button';closePicker.className='chat-photo-picker-cancel';closePicker.textContent='Отмена';
 picker.append(heading,g,c,closePicker);document.body.append(picker);
 function hidePicker(){picker.hidden=true;document.body.classList.remove('chat-photo-menu-open')}
 button.onclick=()=>{const opening=picker.hidden;picker.hidden=!opening;document.body.classList.toggle('chat-photo-menu-open',opening)};
 picker.addEventListener('click',e=>{if(e.target===picker)hidePicker()});
 closePicker.onclick=hidePicker;
 function openInput(input){
  if(busy)return;
  selectedContext=context();
  if(!selectedContext){hidePicker();report('Сначала откройте чат');return}
  input.value='';
  input.click();
  hidePicker();
 }
 g.onclick=()=>openInput(gallery);c.onclick=()=>openInput(camera);
 const preview=document.createElement('div');preview.className='chat-photo-draft';preview.hidden=true;
 const image=document.createElement('img');image.alt='Предпросмотр фотографии';image.hidden=true;
 const details=document.createElement('span');details.className='chat-photo-details';
 const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Отмена';
 const send=document.createElement('button');send.type='button';send.textContent='Отправить фото';
 preview.append(image,details,cancel,send);
 const composer=button.closest('.composer')||button.parentElement;composer.parentElement.insertBefore(preview,composer.nextSibling);
 let draft=null,objectUrl=null,savedContext=null,selectedContext=null,busy=false,revision=0;
 function clear(){
  revision++;
  if(objectUrl)URL.revokeObjectURL(objectUrl);
  objectUrl=null;draft=null;savedContext=null;
  image.removeAttribute('src');image.hidden=true;
  preview.hidden=true;gallery.value='';camera.value='';
 }
 function report(message){
  details.textContent=message;
  details.setAttribute('role','status');
  preview.hidden=false;
  send.hidden=!draft;
  onError(message);
 }
 function sameChat(first,second){
  return first&&second&&first.kind===second.kind&&first.peer===second.peer&&first.group===second.group;
 }
 cancel.onclick=()=>{if(!busy)clear()};
 async function chosen(input){
  const file=input.files?.[0];
  if(!file||busy)return;
  const ctx=selectedContext;
  clear();
  const current=revision;
  try{
   if(!sameChat(ctx,context()))throw Error('Чат изменился. Прикрепите снимок в нужном чате.');
   preview.hidden=false;
   send.hidden=true;
   details.textContent='Подготавливаем фото…';
   const blob=await compress(file);
   if(current!==revision)return;
   if(!sameChat(ctx,context())){clear();return}
   savedContext=ctx;
   draft=blob;
   objectUrl=URL.createObjectURL(blob);
   image.src=objectUrl;
   image.hidden=false;
   send.hidden=false;
   details.textContent='Фото · '+Math.max(1,Math.round(blob.size/1024))+' КБ';
  }catch(error){if(current===revision)report(error.message||String(error))}
 }
 gallery.onchange=()=>chosen(gallery);camera.onchange=()=>chosen(camera);
 send.onclick=async()=>{if(!draft||busy)return;busy=true;send.disabled=true;cancel.disabled=true;try{
 const ctx=savedContext;
 if(!sameChat(ctx,context()))throw Error('Чат изменился. Прикрепите снимок в нужном чате.');
 const session=await window.EdPVZAccount.ensure();if(!session?.access_token)throw Error('Войдите в аккаунт');
 const form=new FormData();form.append('image',draft,'photo.jpg');form.append('kind',ctx.kind);
 if(ctx.peer)form.append('peer',ctx.peer);if(ctx.group)form.append('group',ctx.group);
 const response=await fetch(api,{method:'POST',headers:{Authorization:'Bearer '+session.access_token},body:form});const data=await response.json().catch(()=>({}));
 if(!response.ok||!data.ok)throw Error(data.error||'Не удалось загрузить фото');
 await onSent('[Фото] '+data.url,ctx);clear();
 }catch(e){report(e.message||String(e))}finally{busy=false;send.disabled=false;cancel.disabled=false}};
}
window.EdPVZChatImage={attach,parse,render};
})();