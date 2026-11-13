(function(){'use strict';
const api='https://duerixyhzapotoeclggz.supabase.co/functions/v1/edpvz-chat-image';
const rx=/^\[Фото\] (https:\/\/raw\.githubusercontent\.com\/edholod\/ed-pvz\/main\/assets\/chat-images\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:jpg|webp|png))$/;
function parse(body){return rx.exec(String(body||''))?.[1]||null}
async function compress(file){
 if(!file.type.startsWith('image/'))throw Error('Выберите фотографию');
 const bitmap=await createImageBitmap(file).catch(()=>null);
 if(!bitmap)throw Error('Не удалось открыть фото. Выберите JPEG, PNG или WebP');
 const max=1600,scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));
 const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
 canvas.getContext('2d',{alpha:false}).drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();
 let blob=null;
 for(const q of [.82,.72,.6,.48]){blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',q));if(blob&&blob.size<=1700000)break}
 if(!blob||blob.size>1800000)throw Error('Не удалось достаточно сжать фото');
 return blob;
}
function render(body){const url=parse(body);if(!url)return null;const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.className='chat-photo-link';const img=document.createElement('img');img.src=url;img.alt='Фото в сообщении';img.loading='lazy';img.className='chat-photo';link.append(img);return link}
function attach(button,context,onSent,onError){
 const gallery=document.createElement('input');gallery.type='file';gallery.accept='image/*';gallery.hidden=true;
 const camera=document.createElement('input');camera.type='file';camera.accept='image/*';camera.setAttribute('capture','environment');camera.hidden=true;
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
 g.onclick=()=>{hidePicker();gallery.click()};c.onclick=()=>{hidePicker();camera.click()};
 const preview=document.createElement('div');preview.className='chat-photo-draft';preview.hidden=true;
 const image=document.createElement('img');image.alt='Предпросмотр фотографии';
 const details=document.createElement('span');details.className='chat-photo-details';
 const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Отмена';
 const send=document.createElement('button');send.type='button';send.textContent='Отправить фото';
 preview.append(image,details,cancel,send);
 const composer=button.closest('.composer')||button.parentElement;composer.parentElement.insertBefore(preview,composer.nextSibling);
 let draft=null,objectUrl=null,savedContext=null,busy=false;
 function clear(){if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=null;draft=null;savedContext=null;image.removeAttribute('src');preview.hidden=true;gallery.value='';camera.value=''}
 cancel.onclick=()=>{if(!busy)clear()};
 async function chosen(input){try{const file=input.files?.[0];if(!file)return;const ctx=context();if(!ctx)throw Error('Сначала откройте чат');const blob=await compress(file);savedContext=ctx;draft=blob;if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=URL.createObjectURL(blob);image.src=objectUrl;details.textContent='Сжато: '+Math.max(1,Math.round(blob.size/1024))+' КБ · исходник '+Math.max(1,Math.round(file.size/1024))+' КБ';preview.hidden=false}catch(e){onError(e.message||String(e))}}
 gallery.onchange=()=>chosen(gallery);camera.onchange=()=>chosen(camera);
 send.onclick=async()=>{if(!draft||busy)return;busy=true;send.disabled=true;cancel.disabled=true;try{
 const session=await window.EdPVZAccount.ensure();if(!session?.access_token)throw Error('Войдите в аккаунт');
 const form=new FormData();form.append('image',draft,'photo.jpg');form.append('kind',savedContext.kind);
 if(savedContext.peer)form.append('peer',savedContext.peer);if(savedContext.group)form.append('group',savedContext.group);
 const response=await fetch(api,{method:'POST',headers:{Authorization:'Bearer '+session.access_token},body:form});const data=await response.json().catch(()=>({}));
 if(!response.ok||!data.ok)throw Error(data.error||'Не удалось загрузить фото');
 await onSent('[Фото] '+data.url);clear();
 }catch(e){onError(e.message||String(e))}finally{busy=false;send.disabled=false;cancel.disabled=false}};
}
window.EdPVZChatImage={attach,parse,render};
})();