(function(){'use strict';
const api='https://duerixyhzapotoeclggz.supabase.co/functions/v1/edpvz-chat-voice';
const rx=/^\[Голосовое сообщение\] (https:\/\/raw\.githubusercontent\.com\/edholod\/ed-pvz\/main\/assets\/chat-voice\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:webm|m4a|ogg|mp3|aac))$/;
function parse(text){const m=rx.exec(String(text||''));return m?m[1]:null}
function attach(button,context,onSent,onError){let recorder=null,chunks=[],stream=null,started=0,timer=null,working=false;
const label=button.textContent||'Голосовое';
function reset(){if(timer)clearInterval(timer);timer=null;button.textContent=label;button.disabled=false;if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}}
button.addEventListener('click',async()=>{
 if(working)return;
 if(recorder?.state==='recording'){recorder.stop();return}
 try{
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw Error('Запись звука не поддерживается этим браузером');
  stream=await navigator.mediaDevices.getUserMedia({audio:true});
  const formats=['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/ogg'];
  const mime=formats.find(t=>MediaRecorder.isTypeSupported(t));
  if(!mime)throw Error('Формат записи не поддерживается');
  recorder=new MediaRecorder(stream,{mimeType:mime,audioBitsPerSecond:48000});
  chunks=[];started=Date.now();
  recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
  recorder.onerror=()=>{onError('Не удалось записать звук');reset()};
  recorder.onstop=async()=>{
   working=true;button.disabled=true;button.textContent='Отправка…';
   try{
    const blob=new Blob(chunks,{type:mime.split(';')[0]});
    if(blob.size>2200000)throw Error('Голосовое слишком большое (максимум 2 МБ)');
    const ctx=context();if(!ctx)throw Error('Сначала откройте чат');
    const session=await window.EdPVZAccount.ensure();
    if(!session?.access_token)throw Error('Войдите в аккаунт');
    const form=new FormData();form.append('audio',blob,'voice.'+(mime.startsWith('audio/mp4')?'m4a':mime.startsWith('audio/ogg')?'ogg':'webm'));form.append('kind',ctx.kind);
    if(ctx.peer)form.append('peer',ctx.peer);if(ctx.group)form.append('group',ctx.group);
    const response=await fetch(api,{method:'POST',headers:{Authorization:'Bearer '+session.access_token},body:form});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.ok)throw Error(data.error==='github_not_configured'?'Хранилище GitHub не настроено':data.error==='size_limit_2mb'?'Голосовое слишком большое':data.error||'Не удалось загрузить аудио');
    await onSent('[Голосовое сообщение] '+data.url);
   }catch(e){onError(e.message||String(e))}finally{working=false;reset()}
  };
  recorder.start();button.textContent='■ Стоп · 0:00';
  timer=setInterval(()=>{if(recorder?.state!=='recording')return;const seconds=Math.floor((Date.now()-started)/1000);button.textContent='■ Стоп · '+Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');if(seconds>=55)recorder.stop()},500);
 }catch(e){onError(e.message||String(e));reset()}
});
}
function render(body){const url=parse(body);if(!url)return null;const audio=document.createElement('audio');audio.controls=true;audio.preload='none';audio.src=url;audio.style.cssText='max-width:100%;width:255px';audio.setAttribute('aria-label','Голосовое сообщение');return audio}
window.EdPVZVoice={attach,render,parse};
})();