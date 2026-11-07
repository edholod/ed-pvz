'use strict';
// No secret credentials are stored in this file. All identity checks run on the server.
function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value)}
const SYNC_URL='https://duerixyhzapotoeclggz.supabase.co/functions/v1/pvz-control';
let syncBusy=false,syncUser='',syncMessage='Локальное хранение',syncConflict=false,syncTimer;
let syncMeta={revision:0,base:null};
function prepareTelegram(){try{const app=window.Telegram?.WebApp;app?.ready();app?.expand()}catch{}}
prepareTelegram();
function initData(){
 const sdk=window.Telegram?.WebApp?.initData;if(sdk)return sdk;
 // Telegram's signed launch data is also present when its optional SDK cannot load.
 return new URLSearchParams(location.hash.slice(1)).get('tgWebAppData')||'';
}
function syncStatus(message){syncMessage=message;let banner=document.getElementById('connection-banner');if(!banner){banner=document.createElement('div');banner.id='connection-banner';banner.setAttribute('role','status');document.body.prepend(banner)}banner.textContent=message;banner.className=syncUser?'connection-banner':'connection-banner connection-local';const el=document.getElementById('sync-status');if(el)el.textContent=message;syncPanel()}
function syncPanel(){
 let panel=document.getElementById('sync-panel');
 if(!panel){panel=document.createElement('section');panel.id='sync-panel';panel.className='sync-panel';document.querySelector('.app-footer')?.prepend(panel)}
 panel.innerHTML=`<strong>Хранение и синхронизация</strong><p role="status">${esc(syncMessage)}</p>${syncUser?`<p>Telegram ID: ${esc(syncUser)}. ${syncMeta.revision?'Серверная версия: '+syncMeta.revision:''}</p>`:''}<button onclick="runSync()">Проверить синхронизацию</button><button onclick="backup()">Резервная копия JSON</button><button onclick="downloadRawStorage()">Исходные локальные данные</button><button onclick="localRecovery()">Контрольные копии</button>${syncConflict?`<p class="sync-warning">На сервере и на устройстве разные изменения. Автоматическая замена остановлена. Перед выбором скачайте резервную копию.</p><button onclick="resolveSync('server')">Загрузить серверную версию</button><button onclick="resolveSync('local')">Сохранить эту версию на сервер</button>`:''}${syncUser?'<button onclick="cloudBackup()">Скачать серверную резервную копию</button>':''}`;
}
function localRecovery(){
 try{const copies=JSON.parse(localStorage.getItem(KEY+'-recovery')||'[]');
 if(!copies.length)return alert('Контрольных копий пока нет.');
 const selected=prompt('Номер контрольной копии:\n'+copies.map((x,i)=>(i+1)+' · '+x.at).join('\n'),'1');if(selected===null)return;
 const item=copies[Number(selected)-1];if(!item)return alert('Выберите номер из списка.');
 download('PVZ_CONTROL_recovery_'+Date.now()+'.json',JSON.stringify({app:'PVZ_CONTROL',version:1,data:item.data}),'application/json');
 }catch{alert('Не удалось прочитать контрольные копии.')}
}
function downloadRawStorage(){download('PVZ_CONTROL_raw_'+Date.now()+'.txt',localStorage.getItem(KEY+'-damaged')||localStorage.getItem(KEY)||'', 'text/plain')}
async function api(payload){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 try{
  const response=await fetch(SYNC_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,initData:initData()}),signal:controller.signal});
  const result=await response.json();
  if(!response.ok){const e=new Error(result.error||'SERVER_ERROR');e.status=response.status;throw e}
  return result;
 }finally{clearTimeout(timer)}
}
function metaKey(){return KEY+'-cloud'}
function storeMeta(){localStorage.setItem(metaKey(),JSON.stringify(syncMeta))}
function checkpoint(reason){
 const key=KEY+'-recovery';
 let copies=[];try{copies=JSON.parse(localStorage.getItem(key))||[]}catch{}
 copies.unshift({at:new Date().toISOString(),reason,data:JSON.parse(JSON.stringify(db))});
 localStorage.setItem(key,JSON.stringify(copies.slice(0,3)));
}
function adopt(data){
 validate(data);checkpoint('before-server-load');writeLocal(JSON.stringify(data));db=data;undo=[];redo=[];closeSheet();render();
}
async function identify(result){
 const user=String(result.user_id);
 if(syncUser===user)return;
 const target='pvz-control-tg-'+user;
 let local=localStorage.getItem(target),legacy=localStorage.getItem('pvz-control-v1');
 if(!local&&legacy&&JSON.parse(legacy).points?.length){
  if(confirm('Найдены прежние данные на этом устройстве. Привязать их копию к этому Telegram-аккаунту? Исходная база останется сохранённой.'))local=legacy;
 }
 const next=local?JSON.parse(local):empty();validate(next);
 KEY=target;persistedSnapshot=localStorage.getItem(KEY);storageFault=false;
 writeLocal(JSON.stringify(next));db=next;syncUser=user;localStorage.setItem('pvz-control-active-key',KEY);
 syncMeta=JSON.parse(localStorage.getItem(metaKey())||'null')||{revision:0,base:null};
 undo=[];redo=[];closeSheet();render();
}
async function runSync(){
 if(syncBusy||syncConflict)return;
 if(!initData()){syncStatus('Локальный режим: Telegram не передал данные для входа. Откройте «Календарь смен» кнопкой меню рядом со строкой ввода в боте. Пока данные сохраняются только на этом устройстве.');return}
 if(!navigator.onLine){syncStatus('Нет интернета. Изменения сохранены на устройстве и ожидают отправки.');return}
 if(storageFault){syncStatus('Синхронизация остановлена: проверьте локальную базу.');return}
 syncBusy=true;
 try{
  syncStatus('Синхронизация…');
  const result=await api({action:'read'});await identify(result);
  const remote=result.state,local=JSON.stringify(db),base=syncMeta.base;
  if(remote){validate(remote.data);const remoteText=JSON.stringify(remote.data);
   if(canonical(remote.data)===canonical(db)){syncMeta={revision:remote.revision,base:local};storeMeta()}
   else if(base===local || (!base&&!db.points.length&&!db.people.length)){
    adopt(remote.data);syncMeta={revision:remote.revision,base:JSON.stringify(db)};storeMeta();
   }else if(remote.revision!==syncMeta.revision){syncConflict=true;syncStatus('Обнаружены изменения на другом устройстве. Требуется выбрать версию.');return}
  }
  if(!remote||JSON.stringify(db)!==syncMeta.base){
   const snapshot=JSON.stringify(db);validate(db);
   const written=await api({action:'write',revision:remote?.revision||0,data:JSON.parse(snapshot)});
   syncMeta={revision:written.revision,base:snapshot};storeMeta();
  }
  syncStatus(JSON.stringify(db)===syncMeta.base?'Синхронизировано · '+new Date().toLocaleTimeString('ru-RU'):'Новые изменения ожидают отправки');
 }catch(e){
  if(e.status===409){syncConflict=true;syncStatus('Одновременное изменение с другого устройства. Обе версии сохранены; выберите нужную.')}
  else syncStatus(e.message==='SERVER_NOT_CONFIGURED'?'Сервер подготовлен. Владелец должен подключить Telegram-бота. Данные сохранены локально.':e.status===401?'Telegram не подтвердил вход. Закройте и заново откройте приложение через кнопку бота.':'Не удалось связаться с сервером. Локальные изменения сохранены; повторим подключение.');
 }finally{syncBusy=false;syncPanel()}
}
async function resolveSync(choice){
 if(syncBusy||!syncUser)return;
 if(!confirm(choice==='local'?'Заменить серверную базу этой версией? Предыдущая серверная версия останется в резервных копиях.':'Заменить локальную базу серверной? Локальная контрольная копия будет сохранена.'))return;
 syncBusy=true;
 try{
  const r=await api({action:'read'});if(String(r.user_id)!==syncUser)throw Error('ACCOUNT');
  const captured=JSON.stringify(db);checkpoint('conflict-'+choice);
  if(choice==='server'){
   if(!r.state)throw Error('NO_STATE');adopt(r.state.data);syncMeta={revision:r.state.revision,base:JSON.stringify(db)};
  }else{
   validate(db);const w=await api({action:'write',revision:r.state?.revision||0,data:JSON.parse(captured)});syncMeta={revision:w.revision,base:captured};
  }
  storeMeta();syncConflict=false;syncStatus('Выбранная версия сохранена.');
 }catch{syncStatus('Не удалось разрешить конфликт. Данные не удалены. Повторите попытку.')}finally{syncBusy=false}
}
async function cloudBackup(){
 try{const r=await api({action:'backups'});if(!r.backups.length)return alert('Серверных резервных копий пока нет. Они создаются при изменении базы.');
  const selected=prompt('Введите номер версии резервной копии:\n'+r.backups.map(x=>x.revision+' · '+x.created_at).join('\n'),String(r.backups[0].revision));
  if(selected===null)return;const revision=Number(selected);if(!r.backups.some(x=>x.revision===revision))return alert('Выберите версию из списка.');
  const b=await api({action:'backup',revision});validate(b.data);download('PVZ_CONTROL_cloud_'+revision+'.json',JSON.stringify({app:'PVZ_CONTROL',version:1,data:b.data}),'application/json');
 }catch{alert('Не удалось загрузить серверную копию. Попробуйте позже.')}
}
window.addEventListener('pvz-saved',()=>{if(!syncBusy)syncStatus('Изменения сохранены на устройстве; ожидают синхронизации.');clearTimeout(syncTimer);syncTimer=setTimeout(runSync,1000)});
window.addEventListener('storage',e=>{if(e.key===KEY){syncStatus('Данные изменились в другой вкладке. Обновите страницу перед редактированием.')}});
window.addEventListener('online',runSync);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)runSync()});
setInterval(()=>{if(!document.hidden)runSync()},30000);
syncStatus('Подключение…');runSync();

window.addEventListener('load',()=>{prepareTelegram();runSync()});
let telegramChecks=0;const telegramStartup=setInterval(()=>{prepareTelegram();if(initData()){clearInterval(telegramStartup);runSync()}else if(++telegramChecks>=20)clearInterval(telegramStartup)},500);
