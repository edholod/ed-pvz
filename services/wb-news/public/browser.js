'use strict';
const $=id=>document.getElementById(id);
let busy=false,refreshing=false,currentImage=null;
function message(text){$('status').textContent=text}
async function screenshot(){
  if(refreshing||busy)return;refreshing=true;
  try{
    const response=await fetch('/admin/screen?t='+Date.now(),{cache:'no-store'});
    if(!response.ok){if(response.status===401)message('Войдите в панель подключения.');else if(response.status===409)message('Сеанс управления закрыт. Откройте вход в WB в панели.');return}
    const next=URL.createObjectURL(await response.blob()),old=currentImage;
    $('screen').src=next;currentImage=next;if(old)URL.revokeObjectURL(old);
    if(!busy)message('Нажмите поле на странице WB, затем передайте текст.');
  }catch{message('Изображение временно недоступно. Попробуйте обновить.')}
  finally{refreshing=false}
}
async function action(data){
  if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);message('Передаём действие в WB…');
  try{const response=await fetch('/admin/input',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});if(!response.ok)throw Error();message('Действие передано.');return true}
  catch{message('Действие не передано. Проверьте вход в панель и сеанс управления.');return false}
  finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);screenshot()}
}
$('screen').onclick=event=>{const el=$('screen'),rect=el.getBoundingClientRect();if(!el.naturalWidth)return;action({type:'click',x:(event.clientX-rect.left)*el.naturalWidth/rect.width,y:(event.clientY-rect.top)*el.naturalHeight/rect.height})};
$('typing').onsubmit=async event=>{event.preventDefault();if(!$('text').value)return;const text=$('text').value;if(await action({type:'text',text,replace:$('replace').checked}))$('text').value=''};
$('enter').onclick=()=>action({type:'key',key:'Enter'});
$('tab').onclick=()=>action({type:'key',key:'Tab'});
$('refresh').onclick=screenshot;
$('finish').onclick=async()=>{if(busy)return;const response=await fetch('/admin/finish',{method:'POST'});if(response.ok)location.href='/';else message('Не удалось завершить вход. Вернитесь в панель.')};
screenshot();setInterval(()=>{if(!document.hidden)screenshot()},3000);
