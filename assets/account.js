(function(){'use strict';
if(!document.getElementById('edpvz-ios-zoom-fix')){const style=document.createElement('style');style.id='edpvz-ios-zoom-fix';style.textContent='@supports (-webkit-touch-callout:none){input:not([type=checkbox]):not([type=radio]):not([type=range]),textarea,select{font-size:max(16px,1em)!important}}';(document.head||document.documentElement).appendChild(style)}
if(window.EdPVZAccount)return;
const URL='https://duerixyhzapotoeclggz.supabase.co',KEY='sb_publishable_fKE2S2rAz7VMa54rgO4uvQ_vyzFPwmV',SESSION_KEY='edpvz-auth-v1';let session=null,refreshing=null,storageWriteFailed=false;try{session=JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{}const headers=(token)=>({'apikey':KEY,'Content-Type':'application/json',...(token?{'Authorization':'Bearer '+token}:{})});async function request(path,options={}){
 const {signal:externalSignal,...rest}=options;
 const method=String(rest.method||'GET').toUpperCase();
 const canRetry=method==='GET'||path.startsWith('/auth/v1/token?grant_type=refresh_token');
 let lastError;
 for(let attempt=0;attempt<(canRetry?3:1);attempt++){
  externalSignal?.throwIfAborted();
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),12000);
  const abort=()=>controller.abort();
  externalSignal?.addEventListener('abort',abort,{once:true});
  try{
   const r=await fetch(URL+path,{...rest,signal:controller.signal,headers:{...headers(session?.access_token),...rest.headers}});
   const raw=await r.text();let data;
   try{data=JSON.parse(raw)}catch{data={message:raw}}
   if(!r.ok){
    const error=Error(data.msg||data.error_description||data.message||data.error||('HTTP '+r.status));
    error.status=r.status;error.code=data.error_code||data.code;
    if(!canRetry||![429,502,503,504].includes(r.status))throw error;
    lastError=error;
   }else return data;
  }catch(e){
   lastError=e;
   if(!canRetry||externalSignal?.aborted||e.status&&![429,502,503,504].includes(e.status))throw e;
  }finally{clearTimeout(timer);externalSignal?.removeEventListener('abort',abort)}
  if(attempt<2)await new Promise(resolve=>setTimeout(resolve,400*(attempt+1)));
 }
 throw lastError||Error('Не удалось подключиться к серверу');
}function setSession(s){session=s&&s.access_token?{...s,expires_at:s.expires_at||(Math.floor(Date.now()/1000)+(s.expires_in||3600))}:null;try{if(session)localStorage.setItem(SESSION_KEY,JSON.stringify(session));else localStorage.removeItem(SESSION_KEY);storageWriteFailed=false}catch{storageWriteFailed=true}window.dispatchEvent(new CustomEvent('edpvz-auth-changed',{detail:{user:session?.user||null}}))}const endedSessionCodes=new Set(['refresh_token_not_found','refresh_token_already_used','session_not_found','session_expired','user_not_found','user_banned']);
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
  return locks?locks.request(SESSION_KEY+'-refresh',{signal:AbortSignal.timeout(6000)},update):update();
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
async function signUp(email,password){const data=await request('/auth/v1/signup',{method:'POST',body:JSON.stringify({email,password})});if(data.access_token)setSession(data);return data}async function signIn(login,password){const value=String(login).trim().toLowerCase();if(!/^[a-z0-9_]{3,32}$/.test(value)&&!/^\S+@\S+\.\S+$/.test(value))throw Error('Введите логин или почту существующего аккаунта');const email=value.includes('@')?value:value+'@accounts.edpvz.invalid';const data=await request('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})});setSession(data);return data}async function registerUsername(username,password,role){const r=await fetch(URL+'/functions/v1/edpvz-register',{method:'POST',headers:{'apikey':KEY,'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({username,password,role})});const data=await r.json();if(!r.ok)throw Error(data.message||'Ошибка регистрации');return signIn(username,password)}async function signInWithTelegram(telegram){if(!telegram||typeof telegram!=='object')throw Error('Telegram не подтвердил вход');const response=await fetch(URL+'/functions/v1/edpvz-telegram-link',{method:'POST',headers:{'apikey':KEY,'Content-Type':'application/json'},body:JSON.stringify({action:'login',telegram}),signal:AbortSignal.timeout(20000)});const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||'Не удалось войти через Telegram');if(!data.session?.access_token||!data.session?.refresh_token||!data.session?.user?.id)throw Error('Сервер не вернул сессию');setSession(data.session);return data.session}
async function registerWithTelegram(telegram,username,role){const response=await fetch(URL+'/functions/v1/edpvz-telegram-link',{method:'POST',headers:{'apikey':KEY,'Content-Type':'application/json'},body:JSON.stringify({action:'register',telegram,username,role}),signal:AbortSignal.timeout(25000)});const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||'Не удалось зарегистрироваться через Telegram');if(!data.session?.access_token||!data.session?.refresh_token||!data.session?.user?.id)throw Error('Аккаунт создан. Войдите через Telegram');setSession(data.session);return data.session}
const GITHUB_FLOW_KEY='edpvz-github-oauth-flow';
function githubRedirect(){return location.origin+'/apps/account/'}
function beginGithubOAuth(mode){if(!['login','register'].includes(mode))throw Error('Некорректный режим GitHub');sessionStorage.setItem(GITHUB_FLOW_KEY,JSON.stringify({mode,started:Date.now()}));location.assign(URL+'/auth/v1/authorize?provider=github&redirect_to='+encodeURIComponent(githubRedirect()))}
async function beginGithubLink(){const current=await ensure();if(!current?.access_token)throw Error('Войдите в аккаунт перед привязкой GitHub');const params=new URLSearchParams({provider:'github',skip_http_redirect:'true',redirect_to:githubRedirect()});const r=await fetch(URL+'/auth/v1/user/identities/authorize?'+params,{headers:{apikey:KEY,Authorization:'Bearer '+current.access_token},signal:AbortSignal.timeout(15000)});const result=await r.json().catch(()=>({}));if(!r.ok||!result.url)throw Error(result.msg||result.message||'Не удалось начать привязку GitHub. Проверьте настройки OAuth и Manual Linking в Supabase');sessionStorage.setItem(GITHUB_FLOW_KEY,JSON.stringify({mode:'link',userId:current.user.id,started:Date.now()}));location.assign(result.url)}
function consumeGithubOAuth(){const hash=new URLSearchParams(location.hash.slice(1));const flowText=sessionStorage.getItem(GITHUB_FLOW_KEY);if(!flowText||!location.hash.includes('access_token=')&&!hash.has('error'))return null;sessionStorage.removeItem(GITHUB_FLOW_KEY);let flow;try{flow=JSON.parse(flowText)}catch{return null}if(Date.now()-flow.started>10*60*1000)throw Error('Время входа GitHub истекло');const error=hash.get('error_description')||hash.get('error');history.replaceState(null,'',location.pathname+location.search);if(error)throw Error(error);const access_token=hash.get('access_token'),refresh_token=hash.get('refresh_token');if(!access_token||!refresh_token)throw Error('GitHub не вернул сессию');const userPayload=access_token.split('.')[1];let userId='';try{const payload=JSON.parse(atob(userPayload.replace(/-/g,'+').replace(/_/g,'/')));userId=payload.sub}catch{}if(!userId)throw Error('Некорректная сессия GitHub');if(flow.mode==='link'&&flow.userId!==userId)throw Error('GitHub вернул другой аккаунт. Привязка остановлена');setSession({access_token,refresh_token,expires_in:Number(hash.get('expires_in')||3600),token_type:'bearer',user:{id:userId}});return {...flow,userId}}
async function githubProfile(action,username,role){const current=await ensure();if(!current?.access_token)throw Error('Войдите через GitHub');const response=await fetch(URL+'/functions/v1/edpvz-github-profile',{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+current.access_token,'Content-Type':'application/json'},body:JSON.stringify({action,username,role}),signal:AbortSignal.timeout(18000)});const result=await response.json().catch(()=>({}));if(!response.ok)throw Error(result.error||'Не удалось загрузить профиль GitHub');return result}
async function githubIdentity(){const current=await ensure();if(!current?.access_token)throw Error('Войдите в аккаунт');const response=await fetch(URL+'/auth/v1/user',{headers:{apikey:KEY,Authorization:'Bearer '+current.access_token},signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('Не удалось проверить GitHub');const user=await response.json();return (user.identities||[]).find(item=>item.provider==='github')||null}
const GOOGLE_FLOW_KEY='edpvz-google-oauth-flow';
function googleRedirect(){return location.origin+'/apps/account/'}
function beginGoogleOAuth(mode){if(!['login','register'].includes(mode))throw Error('Некорректный режим Google');sessionStorage.setItem(GOOGLE_FLOW_KEY,JSON.stringify({mode,started:Date.now()}));location.assign(URL+'/auth/v1/authorize?provider=google&redirect_to='+encodeURIComponent(googleRedirect()))}
async function beginGoogleLink(){const current=await ensure();if(!current?.access_token)throw Error('Войдите в аккаунт перед привязкой Google');const params=new URLSearchParams({provider:'google',skip_http_redirect:'true',redirect_to:googleRedirect()});const r=await fetch(URL+'/auth/v1/user/identities/authorize?'+params,{headers:{apikey:KEY,Authorization:'Bearer '+current.access_token},signal:AbortSignal.timeout(15000)});const result=await r.json().catch(()=>({}));if(!r.ok||!result.url)throw Error(result.msg||result.message||'Не удалось начать привязку Google. Проверьте настройки OAuth и Manual Linking в Supabase');sessionStorage.setItem(GOOGLE_FLOW_KEY,JSON.stringify({mode:'link',userId:current.user.id,started:Date.now()}));location.assign(result.url)}
function consumeGoogleOAuth(){const hash=new URLSearchParams(location.hash.slice(1));const flowText=sessionStorage.getItem(GOOGLE_FLOW_KEY);if(!flowText||!location.hash.includes('access_token=')&&!hash.has('error'))return null;sessionStorage.removeItem(GOOGLE_FLOW_KEY);let flow;try{flow=JSON.parse(flowText)}catch{return null}if(Date.now()-flow.started>10*60*1000)throw Error('Время входа Google истекло');const error=hash.get('error_description')||hash.get('error');history.replaceState(null,'',location.pathname+location.search);if(error)throw Error(error);const access_token=hash.get('access_token'),refresh_token=hash.get('refresh_token');if(!access_token||!refresh_token)throw Error('Google не вернул сессию');const userPayload=access_token.split('.')[1];let userId='';try{const payload=JSON.parse(atob(userPayload.replace(/-/g,'+').replace(/_/g,'/')));userId=payload.sub}catch{}if(!userId)throw Error('Некорректная сессия Google');if(flow.mode==='link'&&flow.userId!==userId)throw Error('Google вернул другой аккаунт. Привязка остановлена');setSession({access_token,refresh_token,expires_in:Number(hash.get('expires_in')||3600),token_type:'bearer',user:{id:userId}});return {...flow,userId}}
async function googleProfile(action,username,role){const current=await ensure();if(!current?.access_token)throw Error('Войдите через Google');const response=await fetch(URL+'/functions/v1/edpvz-google-profile',{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+current.access_token,'Content-Type':'application/json'},body:JSON.stringify({action,username,role}),signal:AbortSignal.timeout(18000)});const result=await response.json().catch(()=>({}));if(!response.ok)throw Error(result.error||'Не удалось загрузить профиль Google');return result}
async function googleIdentity(){const current=await ensure();if(!current?.access_token)throw Error('Войдите в аккаунт');const response=await fetch(URL+'/auth/v1/user',{headers:{apikey:KEY,Authorization:'Bearer '+current.access_token},signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('Не удалось проверить Google');const user=await response.json();return (user.identities||[]).find(item=>item.provider==='google')||null}
const PKCE_PROVIDERS = {
 apple: 'Apple',
 'custom:yandex': 'Яндекс',
 'custom:vk': 'ВКонтакте'
};
const PKCE_FLOW_KEY = 'edpvz-pkce-oauth-flow';

async function appleOAuthEnabled() {
 return (await request('/auth/v1/settings')).external?.apple === true;
}

async function vkOAuthConfigured() {
 const response = await fetch(URL + '/functions/v1/edpvz-vk-id/status', { signal: AbortSignal.timeout(6000) });
 return response.ok && (await response.json()).configured === true;
}

async function beginOAuth(provider, draft, link = false) {
 if (!Object.hasOwn(PKCE_PROVIDERS, provider)) throw Error('Способ входа недоступен.');
 const verifier = Array.from(crypto.getRandomValues(new Uint8Array(32)),
  byte => byte.toString(16).padStart(2, '0')).join('');
 const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
 const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
 const params = new URLSearchParams({
  provider,
  redirect_to: location.origin + '/apps/account/',
  code_challenge: challenge,
  code_challenge_method: 's256'
 });
 let userId;
 let authorizationUrl = URL + '/auth/v1/authorize?' + params;
 if (link) {
  const current = await ensure();
  if (!current?.user?.id) throw Error('Войдите в аккаунт перед привязкой.');
  userId = current.user.id;
  params.set('skip_http_redirect', 'true');
  const result = await request('/auth/v1/user/identities/authorize?' + params, {
   headers: { Authorization: 'Bearer ' + current.access_token }
  });
  if (!result.url) throw Error('Не удалось начать привязку.');
  authorizationUrl = result.url;
 }
 sessionStorage.setItem(PKCE_FLOW_KEY, JSON.stringify({ provider, verifier, draft, userId, started: Date.now() }));
 // The profile can be embedded in the portal. OAuth must run in the main window.
 window.top.location.assign(authorizationUrl);
}

async function consumeOAuth() {
 const storedFlow = sessionStorage.getItem(PKCE_FLOW_KEY) || sessionStorage.getItem('edpvz-apple-oauth-flow');
 const query = new URLSearchParams(location.search);
 const hash = new URLSearchParams(location.hash.slice(1));
 const code = query.get('code');
 const error = query.get('error') || hash.get('error');
 const callbackErrorCode = query.get('error_code') || hash.get('error_code');
 if (!code && (!error || !storedFlow)) return null;
 sessionStorage.removeItem(PKCE_FLOW_KEY);
 sessionStorage.removeItem('edpvz-apple-oauth-flow');
 for (const key of ['code', 'error', 'error_code', 'error_description']) {
  query.delete(key);
  hash.delete(key);
 }
 history.replaceState(null, '', location.pathname +
  (query.size ? '?' + query : '') + (hash.size ? '#' + hash : ''));
 if (!storedFlow) throw Error('Откройте страницу входа в том же браузере и начните вход заново.');
 const { provider = 'apple', verifier, draft, userId, started } = JSON.parse(storedFlow);
 if (Date.now() - started > 10 * 60 * 1000) throw Error('Время входа истекло. Попробуйте ещё раз.');
 if (error) {
  if (userId && callbackErrorCode === 'identity_already_exists') {
   throw Error('Этот аккаунт уже привязан к профилю «Эд ПВЗ».');
  }
  throw Error(userId ? 'Привязка не завершена. Попробуйте ещё раз.' : 'Вход не завершён. Попробуйте ещё раз.');
 }
 if (userId && (await ensure())?.user?.id !== userId) {
  throw Error('Аккаунт изменился. Начните привязку заново.');
 }
 const data = await request('/auth/v1/token?grant_type=pkce', {
  method: 'POST',
  body: JSON.stringify({ auth_code: code, code_verifier: verifier })
 });
 if (!data.access_token || !data.refresh_token || !data.user?.id) {
  throw Error('Не удалось получить сессию.');
 }
 if (userId && data.user.id !== userId) throw Error('Получена сессия другого аккаунта.');
 // Only keep the Ed PVZ session, not the upstream provider's tokens.
 const { provider_token, provider_refresh_token, ...accountSession } = data;
 setSession(accountSession);
 return { provider, draft, linked: Boolean(userId) };
}

async function oauthIdentity(provider) {
 const current = await ensure();
 if (!current?.user?.id) return null;
 const user = await request('/auth/v1/user', { headers: { Authorization: 'Bearer ' + current.access_token } });
 return user.identities?.find(identity => identity.provider === provider) || null;
}

async function signOut(){try{if(session)await request('/auth/v1/logout',{method:'POST'})}finally{setSession(null)}}async function load(namespace){await ensure();if(!session)throw Error('Войдите в аккаунт');const id=encodeURIComponent(session.user.id),ns=encodeURIComponent(namespace);const rows=await request('/rest/v1/edpvz_user_data?user_id=eq.'+id+'&namespace=eq.'+ns+'&select=payload,updated_at');return rows[0]||null}async function save(namespace,payload){await ensure();if(!session)throw Error('Войдите в аккаунт');if(!/^[a-z0-9_-]{1,64}$/.test(namespace))throw Error('Некорректный раздел');const rows=await request('/rest/v1/edpvz_user_data?on_conflict=user_id,namespace',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({user_id:session.user.id,namespace,payload,updated_at:new Date().toISOString()})});return rows[0]}// Storage events also fire in the parent when sign-in happens in a same-origin iframe.
function syncStoredSession(){if(storageWriteFailed)return;let next=null;try{next=JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{return}if(JSON.stringify(next)===JSON.stringify(session))return;session=next&&next.access_token?next:null;window.dispatchEvent(new CustomEvent('edpvz-auth-changed',{detail:{user:session?.user||null}}))}
window.addEventListener('storage',event=>{if(event.key===SESSION_KEY||event.key===null)syncStoredSession()});
function resumeSession(){if(!document.hidden)ensure().catch(()=>{/* Retry on the next request or when the connection returns. */})}
window.addEventListener('focus',resumeSession);
window.addEventListener('pageshow',resumeSession);
window.addEventListener('online',resumeSession);
document.addEventListener('visibilitychange',resumeSession);
async function readTable(path){if(!/^edpvz_[a-z_]+\?/.test(path))throw Error('Некорректная таблица');await ensure();if(!session)throw Error('Войдите в аккаунт');return request('/rest/v1/'+path)}
async function rpc(name,args){if(!['edpvz_calendar_write','edpvz_dispute_manage_access','edpvz_dispute_owner_access','edpvz_dispute_manage_password','edpvz_dispute_redeem_password','edpvz_surveillance_allowed','edpvz_ivideon_allowed','edpvz_ivideon_save_camera'].includes(name))throw Error('Неизвестная операция');await ensure();if(!session)throw Error('Войдите в аккаунт');return request('/rest/v1/rpc/'+name,{method:'POST',body:JSON.stringify(args)})}
async function createPoint(point){await ensure();if(!session)throw Error('Войдите в аккаунт');if(!['wb','ozon','ym'].includes(point.market))throw Error('Выберите маркетплейс');return request('/rest/v1/edpvz_points',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({point_id:point.point_id,name:point.name,market:point.market,owner_id:session.user.id})})}
async function checkIvideon(key,cameraId,quality,action,archive){await ensure();if(!session)throw Error('Войдите в аккаунт');return request('/functions/v1/edpvz-ivideon-check',{method:'POST',body:JSON.stringify({key,cameraId,quality,action,archive})})}
async function archiveRequest(path,body){
 await ensure();
 if(!session)throw Error('Войдите в аккаунт');
 if(!/^\/(jobs|cloud|health)(\/|$)/.test(path)||path.includes('..')||path.includes('?'))throw Error('Некорректный запрос архива');
 const isVideoPart = body instanceof Blob && /^\/jobs\/[\w-]+\/import\/\d+$/.test(path);
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),isVideoPart?900000:120000);
 try{
  const r=await fetch('https://edpvz-archive.onrender.com/archive'+path,{method:body===undefined?'GET':'POST',signal:controller.signal,headers:headers(session.access_token),body:body===undefined?undefined:isVideoPart?body:JSON.stringify(body)});
  const data=await r.json().catch(()=>({detail:'Сервер архива вернул непонятный ответ.'}));
  if(!r.ok){const e=Error(typeof data.detail==='string'?data.detail:'Не удалось выполнить запрос архива');e.status=r.status;throw e;}
  return data;
 }catch(error){if(error.name==='AbortError')throw Error('Сервер архива не ответил вовремя. Повтори запрос.');throw error;}finally{clearTimeout(timer);}
}
async function presencePing(){await ensure();if(!session?.user)return;return request('/rest/v1/edpvz_presence?on_conflict=user_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({user_id:session.user.id,username:''})})}async function presenceRead(names){await ensure();if(!session||!names.length)return [];return request('/rest/v1/edpvz_presence?select=username,last_seen&username=in.('+encodeURIComponent(names.map(n=>'"'+n.replace(/["\\]/g,'')+'"').join(','))+')')}window.EdPVZAccount={presencePing,presenceRead,archiveRequest,checkIvideon,rpc,createPoint,readTable,signUp,registerUsername,signIn,signInWithTelegram,registerWithTelegram,beginGithubOAuth,beginGithubLink,consumeGithubOAuth,githubProfile,githubIdentity,beginGoogleOAuth,beginGoogleLink,consumeGoogleOAuth,googleProfile,googleIdentity,appleOAuthEnabled,beginOAuth,consumeOAuth,oauthIdentity,vkOAuthConfigured,signOut,refresh,ensure,load,save,get user(){return session?.user||null},get signedIn(){return !!session?.access_token}}})();
/* Shared tile motion: mouse only, no layout shifts. */
(()=>{if(document.getElementById('edpvz-tile-motion'))return;const style=document.createElement('style');style.id='edpvz-tile-motion';style.textContent=`@media (hover:hover) and (pointer:fine) and (prefers-reduced-motion:no-preference){:is(.tile,.market-card,.settings-tile,.service-tile,.category-tile,.tool-tile,.menu-tile,.app-tile,.libTile,.tiles>button,.tiles>a,[data-tile]){transition:translate .22s cubic-bezier(.2,.75,.25,1),scale .22s cubic-bezier(.2,.75,.25,1),box-shadow .22s ease,filter .22s ease}:is(.tile,.market-card,.settings-tile,.service-tile,.category-tile,.tool-tile,.menu-tile,.app-tile,.libTile,.tiles>button,.tiles>a,[data-tile]):not(:disabled):not([aria-disabled=true]):hover{translate:0 -3px;scale:1.015;box-shadow:0 9px 22px #30243d24;filter:brightness(1.035)}:is(.tile,.market-card,.settings-tile,.service-tile,.category-tile,.tool-tile,.menu-tile,.app-tile,.libTile,.tiles>button,.tiles>a,[data-tile]):not(:disabled):not([aria-disabled=true]):active{translate:0 0;scale:.985;box-shadow:0 2px 6px #30243d15}:is(.tile,.market-card,.settings-tile,.service-tile,.category-tile,.tool-tile,.menu-tile,.app-tile,.libTile,.tiles>button,.tiles>a,[data-tile]) :is(.tile-icon,.tile-art,.tile-symbol,.edpvz-svg-icon,.brandMark){transition:rotate .24s ease,scale .24s ease}:is(.tile,.market-card,.settings-tile,.service-tile,.category-tile,.tool-tile,.menu-tile,.app-tile,.libTile,.tiles>button,.tiles>a,[data-tile]):hover :is(.tile-icon,.tile-art,.tile-symbol,.edpvz-svg-icon,.brandMark){rotate:-4deg;scale:1.07}}`;document.head.append(style)})();

(()=>{if(window.EdPVZPresence)return;const api=window.EdPVZAccount,cache=new Map();let busy=false,lastPing=0;const style=document.createElement('style');style.textContent='.ed-presence{display:inline-flex;align-items:center;gap:4px;margin-inline-start:6px;font-size:10px;font-weight:600;vertical-align:middle;color:#82788b;white-space:nowrap}.ed-presence.online{color:#27834a;background:#e3f5e8;padding:2px 6px;border-radius:10px}.ed-presence.online:before{content:"";width:7px;height:7px;border-radius:50%;background:#2bb65e;box-shadow:0 0 6px #2bb65e66}';document.head.append(style);function mark(node,name){if(!node||!name)return;node.dataset.presenceUser=String(name).replace(/^@/,'');}window.EdPVZPresence={mark};function scan(){for(const a of document.querySelectorAll('a[href]')){try{const u=new URL(a.href,location.href);if(u.origin===location.origin&&u.pathname==='/apps/profile/'&&u.searchParams.get('user')&&a.textContent.trim()&&!a.querySelector('img'))mark(a,u.searchParams.get('user'))}catch{}}}function paint(){for(const node of document.querySelectorAll('[data-presence-user]')){const stamp=cache.get(node.dataset.presenceUser.toLowerCase());let b=node.querySelector(':scope > .ed-presence');if(!stamp){b?.remove();continue}const mins=Math.max(0,Math.floor((Date.now()-Date.parse(stamp))/60000)),online=mins<2;const label=online?'В сети':mins<60?'Был(а) в сети '+mins+' мин. назад': 'Был(а) в сети '+new Date(stamp).toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});if(!b){b=document.createElement('span');b.className='ed-presence';node.append(b)}b.classList.toggle('online',online);if(b.textContent!==label)b.textContent=label}}async function tick(){if(busy||document.hidden||!api.signedIn)return;busy=true;try{if(window===top&&Date.now()-lastPing>40000){await api.presencePing();lastPing=Date.now()}scan();const names=[...new Set([...document.querySelectorAll('[data-presence-user]')].map(n=>n.dataset.presenceUser))];for(let i=0;i<names.length;i+=50){const rows=await api.presenceRead(names.slice(i,i+50));for(const r of rows)cache.set(r.username.toLowerCase(),r.last_seen)}paint()}catch{}finally{busy=false}}setInterval(tick,30000);window.addEventListener('edpvz-auth-changed',()=>{cache.clear();lastPing=0;tick()});document.addEventListener('visibilitychange',tick);window.addEventListener('pageshow',tick);if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',tick);else tick();let timer;new MutationObserver(records=>{if(records.every(r=>r.target.closest?.('.ed-presence')))return;clearTimeout(timer);timer=setTimeout(()=>{scan();paint()},250)}).observe(document.documentElement,{childList:true,subtree:true})})();