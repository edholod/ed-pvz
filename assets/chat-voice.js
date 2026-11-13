(function(){'use strict';
const api='https://duerixyhzapotoeclggz.supabase.co/functions/v1/edpvz-chat-voice';
const rx=/^\[Голосовое сообщение\] (https:\/\/raw\.githubusercontent\.com\/edholod\/ed-pvz\/main\/assets\/chat-voice\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:webm|m4a|ogg|mp3|aac))$/;
function parse(text){const m=rx.exec(String(text||''));return m?m[1]:null}
function attach(button,context,onSent,onError){
 let recorder=null,chunks=[],stream=null,started=0,timer=null,working=false,draft=null,draftUrl=null,recordContext=null;
 const label=button.innerHTML;
 const composer=button.closest('.composer')||button.parentElement;
 const draftBox=document.createElement('div');draftBox.className='voice-draft';draftBox.hidden=true;
 const title=document.createElement('span');title.className='voice-draft-title';title.textContent='Голосовое готово';
 const preview=document.createElement('audio');preview.controls=true;preview.preload='metadata';preview.setAttribute('aria-label','Прослушать голосовое перед отправкой');
 const discard=document.createElement('button');discard.type='button';discard.className='voice-draft-discard';discard.textContent='Удалить';
 const send=document.createElement('button');send.type='button';send.className='voice-draft-send';send.textContent='Отправить';
 draftBox.append(title,preview,discard,send);composer.parentNode.insertBefore(draftBox,composer.nextSibling);
 function stopTracks(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}}
 function resetButton(){if(timer)clearInterval(timer);timer=null;button.innerHTML=label;button.classList.remove('voice-recording','voice-uploading');button.disabled=false;stopTracks()}
 function clearDraft(){preview.pause();preview.removeAttribute('src');preview.load();if(draftUrl)URL.revokeObjectURL(draftUrl);draftUrl=null;draft=null;recordContext=null;draftBox.hidden=true;button.disabled=false}
 discard.onclick=()=>{clearDraft();resetButton()};
 send.onclick=async()=>{
  if(!draft||working)return;
  working=true;send.disabled=true;discard.disabled=true;button.disabled=true;button.classList.add('voice-uploading');
  try{
   const ctx=recordContext;if(!ctx)throw Error('Чат недоступен. Запишите сообщение заново');
   const session=await window.EdPVZAccount.ensure();if(!session?.access_token)throw Error('Войдите в аккаунт');
   const mime=draft.type;
   const form=new FormData();form.append('audio',draft,'voice.'+(mime==='audio/mp4'?'m4a':mime==='audio/ogg'?'ogg':'webm'));form.append('kind',ctx.kind);
   if(ctx.peer)form.append('peer',ctx.peer);if(ctx.group)form.append('group',ctx.group);
   const response=await fetch(api,{method:'POST',headers:{Authorization:'Bearer '+session.access_token},body:form});
   const data=await response.json().catch(()=>({}));
   if(!response.ok||!data.ok)throw Error(data.error==='github_not_configured'?'Хранилище GitHub не настроено':data.error==='size_limit_2mb'?'Голосовое слишком большое':data.error||'Не удалось загрузить аудио');
   await onSent('[Голосовое сообщение] '+data.url);
   clearDraft();
  }catch(e){onError(e.message||String(e))}
  finally{working=false;send.disabled=false;discard.disabled=false;button.classList.remove('voice-uploading');button.disabled=!!draft}
 };
 button.addEventListener('click',async()=>{
  if(working||draft)return;
  if(recorder?.state==='recording'){recorder.stop();return}
  try{
   recordContext=context();if(!recordContext)throw Error('Сначала откройте чат');
   if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw Error('Запись звука не поддерживается этим браузером');
   stream=await navigator.mediaDevices.getUserMedia({audio:true});
   const formats=['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/ogg'];
   const mime=formats.find(t=>MediaRecorder.isTypeSupported(t));
   if(!mime)throw Error('Формат записи не поддерживается');
   recorder=new MediaRecorder(stream,{mimeType:mime,audioBitsPerSecond:48000});
   chunks=[];started=Date.now();
   recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
   recorder.onerror=()=>{onError('Не удалось записать звук');resetButton()};
   recorder.onstop=()=>{
    resetButton();
    try{
     const blob=new Blob(chunks,{type:mime.split(';')[0]});
     if(blob.size<100)throw Error('Запись слишком короткая');
     if(blob.size>2200000)throw Error('Голосовое слишком большое (максимум 2 МБ)');
     draft=blob;draftUrl=URL.createObjectURL(blob);preview.src=draftUrl;draftBox.hidden=false;button.disabled=true;
    }catch(e){onError(e.message||String(e));clearDraft()}
   };
   recorder.start();button.classList.add('voice-recording');button.textContent='■ 0:00';
   timer=setInterval(()=>{if(recorder?.state!=='recording')return;const seconds=Math.floor((Date.now()-started)/1000);button.textContent='■ '+Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');if(seconds>=55)recorder.stop()},500);
  }catch(e){onError(e.message||String(e));resetButton()}
 });
}
function render(body){const url=parse(body);if(!url)return null;
 const wrap=document.createElement('div');wrap.className='voice-player';
 const play=document.createElement('button');play.type='button';play.className='voice-play';play.setAttribute('aria-label','Воспроизвести голосовое');play.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 10 6-10 6z"/></svg>';
 const bars=document.createElement('div');bars.className='voice-bars';bars.setAttribute('aria-hidden','true');
 const heights=[8,14,19,11,23,16,10,20,25,14,9,18,24,13,21,12,17,25,14,10,19,13,23,15,9,20,16,11];
 for(const h of heights){const bar=document.createElement('span');bar.style.height=h+'px';bars.append(bar)}
 const time=document.createElement('span');time.className='voice-time';time.textContent='0:00';
 const audio=document.createElement('audio');audio.preload='metadata';audio.src=url;
 const fmt=n=>Number.isFinite(n)?Math.floor(n/60)+':'+String(Math.floor(n%60)).padStart(2,'0'):'0:00';
 const sync=()=>{const duration=audio.duration;const pct=duration>0?Math.min(100,audio.currentTime/duration*100):0;bars.style.setProperty('--played',pct+'%');time.textContent=fmt(audio.paused&&audio.currentTime===0?duration:audio.currentTime);play.innerHTML=audio.paused?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 10 6-10 6z"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6v12M16 6v12"/></svg>';play.setAttribute('aria-label',audio.paused?'Воспроизвести голосовое':'Пауза')};
 play.onclick=async()=>{try{if(audio.paused){document.querySelectorAll('.voice-player audio').forEach(a=>{if(a!==audio)a.pause()});await audio.play()}else audio.pause()}catch(e){play.title='Не удалось воспроизвести аудио'}};
 bars.onclick=e=>{if(Number.isFinite(audio.duration)&&audio.duration>0){const box=bars.getBoundingClientRect();audio.currentTime=Math.max(0,Math.min(1,(e.clientX-box.left)/box.width))*audio.duration}};
 for(const event of ['loadedmetadata','timeupdate','play','pause','ended'])audio.addEventListener(event,sync);
 wrap.append(play,bars,time,audio);return wrap}
window.EdPVZVoice={attach,render,parse};
})();