(function(){'use strict';
if(window.EdPVZAccount)return;
const URL='https://duerixyhzapotoeclggz.supabase.co',KEY='sb_publishable_fKE2S2rAz7VMa54rgO4uvQ_vyzFPwmV',SESSION_KEY='edpvz-auth-v1';let session=null,refreshing=null,storageWriteFailed=false;try{session=JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{}const headers=(token)=>({'apikey':KEY,'Content-Type':'application/json',...(token?{'Authorization':'Bearer '+token}:{})});async function request(path,options={}){const r=await fetch(URL+path,{...options,headers:{...headers(session?.access_token),...options.headers}});const text=await r.text();let data;try{data=JSON.parse(text)}catch{data={message:text}}if(!r.ok){const error=Error(data.msg||data.error_description||data.message||('HTTP '+r.status));error.status=r.status;error.code=data.error_code||data.code;throw error}return data}function setSession(s){session=s&&s.access_token?{...s,expires_at:s.expires_at||(Math.floor(Date.now()/1000)+(s.expires_in||3600))}:null;try{if(session)localStorage.setItem(SESSION_KEY,JSON.stringify(session));else localStorage.removeItem(SESSION_KEY);storageWriteFailed=false}catch{storageWriteFailed=true}window.dispatchEvent(new CustomEvent('edpvz-auth-changed',{detail:{user:session?.user||null}}))}const endedSessionCodes=new Set(['refresh_token_not_found','refresh_token_already_used','session_not_found','session_expired','user_not_found','user_banned']);
function refresh(){
 if(refreshing)return refreshing;
 syncStoredSession();
 const token=session?.refresh_token;
 if(!token)return Promise.resolve(session);
 const update=async()=>{
  // Another page may have rotated the token while this page waited for the lock.
  syncStoredSession();
  if(session?.refresh_token!==token)return session;
  try{
   const signal=globalThis.AbortSignal?.timeout?.(15000);
   const data=await request('/auth/v1/token?grant_type=refresh_token',{
    method:'POST',body:JSON.stringify({refresh_token:token}),signal
   });
   if(!data.access_token||!data.refresh_token)throw Error('Не удалось получить обновлённую сессию.');
   syncStoredSession();
   if(session?.refresh_token===token)setSession(data);
   return session;
  }catch(error){
   syncStoredSession();
   if(session?.refresh_token!==token)return session;
   if([400,401,403].includes(error.status)&&endedSessionCodes.has(error.code))setSession(null);
   throw error;
  }
 };
 refreshing=Promise.resolve().then(()=>{
  const locks=globalThis.navigator?.locks;
  return locks?locks.request(SESSION_KEY+'-refresh',update):update();
 }).finally(()=>{refreshing=null});
 return refreshing;
}
async function ensure(){
 syncStoredSession();
 if(session?.expires_at&&Date.now()/1000>session.expires_at-90){
  try{await refresh()}
  catch(error){if(!session||session.expires_at<=Date.now()/1000)throw error}
 }
 return session;
}
async function signUp(email,password){const data=await request('/auth/v1/signup',{method:'POST',body:JSON.stringify({email,password})});if(data.access_token)setSession(data);return data}async function signIn(login,password){const value=String(login).trim().toLowerCase();if(!/^[a-z0-9_]{3,32}$/.test(value)&&!/^\S+@\S+\.\S+$/.test(value))throw Error('Введите логин или почту существующего аккаунта');const email=value.includes('@')?value:value+'@accounts.edpvz.invalid';const data=await request('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})});setSession(data);return data}async function registerUsername(username,password,role){const r=await fetch(URL+'/functions/v1/edpvz-register',{method:'POST',headers:{'apikey':KEY,'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({username,password,role})});const data=await r.json();if(!r.ok)throw Error(data.message||'Ошибка регистрации');return signIn(username,password)}async function signOut(){try{if(session)await request('/auth/v1/logout',{method:'POST'})}finally{setSession(null)}}async function load(namespace){await ensure();if(!session)throw Error('Войдите в аккаунт');const id=encodeURIComponent(session.user.id),ns=encodeURIComponent(namespace);const rows=await request('/rest/v1/edpvz_user_data?user_id=eq.'+id+'&namespace=eq.'+ns+'&select=payload,updated_at');return rows[0]||null}async function save(namespace,payload){await ensure();if(!session)throw Error('Войдите в аккаунт');if(!/^[a-z0-9_-]{1,64}$/.test(namespace))throw Error('Некорректный раздел');const rows=await request('/rest/v1/edpvz_user_data?on_conflict=user_id,namespace',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({user_id:session.user.id,namespace,payload,updated_at:new Date().toISOString()})});return rows[0]}// Storage events also fire in the parent when sign-in happens in a same-origin iframe.
function syncStoredSession(){if(storageWriteFailed)return;let next=null;try{next=JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{return}if(JSON.stringify(next)===JSON.stringify(session))return;session=next&&next.access_token?next:null;window.dispatchEvent(new CustomEvent('edpvz-auth-changed',{detail:{user:session?.user||null}}))}
window.addEventListener('storage',event=>{if(event.key===SESSION_KEY||event.key===null)syncStoredSession()});
function resumeSession(){if(!document.hidden)ensure().catch(()=>{/* Retry on the next request or when the connection returns. */})}
window.addEventListener('focus',resumeSession);
window.addEventListener('pageshow',resumeSession);
window.addEventListener('online',resumeSession);
document.addEventListener('visibilitychange',resumeSession);
async function readTable(path){if(!/^edpvz_[a-z_]+\?/.test(path))throw Error('Некорректная таблица');await ensure();if(!session)throw Error('Войдите в аккаунт');return request('/rest/v1/'+path)}
async function rpc(name,args){if(!['edpvz_calendar_write','edpvz_dispute_manage_access','edpvz_dispute_owner_access'].includes(name))throw Error('Неизвестная операция');await ensure();if(!session)throw Error('Войдите в аккаунт');return request('/rest/v1/rpc/'+name,{method:'POST',body:JSON.stringify(args)})}
async function createPoint(point){await ensure();if(!session)throw Error('Войдите в аккаунт');if(!['wb','ozon','ym'].includes(point.market))throw Error('Выберите маркетплейс');return request('/rest/v1/edpvz_points',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({point_id:point.point_id,name:point.name,market:point.market,owner_id:session.user.id})})}
window.EdPVZAccount={rpc,createPoint,readTable,signUp,registerUsername,signIn,signOut,refresh,ensure,load,save,get user(){return session?.user||null},get signedIn(){return !!session?.access_token}}})();