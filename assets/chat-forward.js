(function(){'use strict';
const base='https://duerixyhzapotoeclggz.supabase.co',key='sb_publishable_fKE2S2rAz7VMa54rgO4uvQ_vyzFPwmV';
async function rpc(name,args={}){const session=await window.EdPVZAccount.ensure();if(!session?.access_token)throw Error('Войдите в аккаунт');const response=await fetch(base+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify(args)});const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.message||'Не удалось переслать сообщение');return data}
function show(message,done){
 document.getElementById('forwardDialog')?.remove();
 const shade=document.createElement('div');shade.id='forwardDialog';shade.className='forward-overlay';
 const card=document.createElement('div');card.className='forward-card';card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');card.setAttribute('aria-label','Переслать сообщение');
 const h=document.createElement('h2');h.textContent='Переслать сообщение';
 const preview=document.createElement('p');preview.className='forward-preview';preview.textContent=window.EdPVZVoice?.parse(message)?'Голосовое сообщение':message.slice(0,120);
 const tabs=document.createElement('div');tabs.className='forward-tabs';
 const nickBtn=document.createElement('button');nickBtn.textContent='По нику';nickBtn.type='button';
 const chatBtn=document.createElement('button');chatBtn.textContent='В чат';chatBtn.type='button';tabs.append(nickBtn,chatBtn);
 const area=document.createElement('div');const error=document.createElement('p');error.className='forward-error';
 const actions=document.createElement('div');actions.className='forward-actions';
 const cancel=document.createElement('button');cancel.textContent='Отмена';cancel.type='button';
 const send=document.createElement('button');send.textContent='Переслать';send.type='button';
 actions.append(cancel,send);card.append(h,preview,tabs,area,error,actions);shade.append(card);document.body.append(shade);
 let mode='nick',selected=null,chatList=[],loaded=false,loadId=0;
 const close=()=>shade.remove();cancel.onclick=close;shade.onclick=e=>{if(e.target===shade)close()};
 const input=document.createElement('input');input.placeholder='Ник пользователя без @';input.maxLength=32;input.autocomplete='off';
 function render(){
  area.replaceChildren();nickBtn.classList.toggle('active',mode==='nick');chatBtn.classList.toggle('active',mode==='chat');
  if(mode==='nick'){area.append(input);return}
  const list=document.createElement('div');list.className='forward-chat-list';list.setAttribute('role','radiogroup');list.setAttribute('aria-label','Выберите чат');
  if(!loaded){const p=document.createElement('p');p.className='forward-hint';p.textContent='Загрузка ваших чатов…';list.append(p)}
  else if(!chatList.length){const p=document.createElement('p');p.className='forward-hint';p.textContent='Пока нет доступных чатов';list.append(p)}
  else for(const chat of chatList){
   const row=document.createElement('button');row.type='button';row.className='forward-chat-row'+(selected?.key===chat.key?' selected':'');row.setAttribute('role','radio');row.setAttribute('aria-checked',selected?.key===chat.key?'true':'false');
   const avatar=document.createElement('span');avatar.className='forward-chat-avatar';avatar.textContent=chat.type==='group'?'#':(chat.name.trim()[0]||'@').toUpperCase();
   const info=document.createElement('span');info.className='forward-chat-info';
   const title=document.createElement('strong');title.textContent=chat.name;
   const subtitle=document.createElement('small');subtitle.textContent=chat.type==='group'?'Групповой чат · '+chat.count+' участников':'Личная переписка · @'+chat.username;
   info.append(title,subtitle);const tick=document.createElement('span');tick.className='forward-chat-tick';tick.textContent=selected?.key===chat.key?'✓':'';
   row.append(avatar,info,tick);row.onclick=()=>{selected=chat;render()};list.append(row);
  }
  area.append(list);
 }
 nickBtn.onclick=()=>{mode='nick';selected=null;error.textContent='';render();input.focus()};
 chatBtn.onclick=async()=>{
  mode='chat';selected=null;error.textContent='';render();const id=++loadId;
  try{
   const [direct,groups]=await Promise.all([rpc('edpvz_dm_inbox_v2'),rpc('edpvz_group_chat_action',{p_action:'list'})]);
   if(id!==loadId||!shade.isConnected)return;
   chatList=[...direct.map(x=>({key:'dm:'+x.username,type:'dm',username:x.username,name:x.display_name||'@'+x.username,date:x.last_at||''})),...groups.map(x=>({key:'group:'+x.id,type:'group',id:x.id,name:x.title,count:x.count||0,date:''}))];
   chatList.sort((a,b)=>{if(a.date&&b.date)return b.date.localeCompare(a.date);return a.type===b.type?0:a.type==='dm'?-1:1});
   loaded=true;render();
  }catch(e){if(id!==loadId||!shade.isConnected)return;loaded=true;error.textContent=e.message;render()}
 };
 send.onclick=async()=>{
  send.disabled=true;error.textContent='';
  try{
   if(mode==='nick'){
    const username=input.value.trim().replace(/^@/,'');if(!/^[a-zA-Z0-9_]{2,32}$/.test(username))throw Error('Введите ник пользователя');
    await rpc('edpvz_dm_send',{target_username:username,message_body:message});
   }else{
    if(!selected)throw Error('Выберите чат из списка');
    if(selected.type==='dm')await rpc('edpvz_dm_send',{target_username:selected.username,message_body:message});
    else await rpc('edpvz_group_chat_action',{p_action:'send',p_group:selected.id,p_body:message});
   }
   close();if(done)await done();
  }catch(e){error.textContent=e.message}finally{send.disabled=false}
 };
 render();
}
window.EdPVZForward={show};
})();