'use strict';
// Local shifts and salary data; confirmed account team is refreshed separately.
// Existing KEY and its saved data are intentionally left unchanged.
function syncStatus(message){
 const status=document.getElementById('sync-status');
 if(status)status.textContent=message;
 let panel=document.getElementById('sync-panel');
 if(!panel){panel=document.createElement('section');panel.id='sync-panel';panel.className='sync-panel';document.querySelector('.app-footer')?.prepend(panel)}
 if(panel){const p=document.createElement('p');p.setAttribute('role','status');p.textContent=message;panel.replaceChildren();const title=document.createElement('strong');title.textContent='Хранение данных';panel.append(title,p);for(const [label,handler] of [['Сохранить копию в облако',cloudBackup],['Восстановить из облака',resolveSync],['Скачать резервную копию JSON',backup],['Скачать исходные данные',downloadRawStorage],['Контрольные копии',localRecovery],['Предыдущая облачная версия',restorePreviousCloud]]){const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',handler);panel.append(b)}}
 document.getElementById('connection-banner')?.remove();
}
function downloadRawStorage(){download('PVZ_CONTROL_raw_'+Date.now()+'.txt',localStorage.getItem(KEY+'-damaged')||localStorage.getItem(KEY)||'','text/plain')}
function localRecovery(){
 try{
  const copies=JSON.parse(localStorage.getItem(KEY+'-recovery')||'[]');
  if(!copies.length)return alert('Контрольных копий пока нет.');
  const selected=prompt('Номер контрольной копии:\n'+copies.map((x,i)=>(i+1)+' · '+x.at).join('\n'),'1');
  if(selected===null)return;
  const item=copies[Number(selected)-1];if(!item)return alert('Выберите номер из списка.');
  download('PVZ_CONTROL_recovery_'+Date.now()+'.json',JSON.stringify({app:'PVZ_CONTROL',version:1,data:item.data}),'application/json');
 }catch{alert('Не удалось прочитать контрольные копии.')}
}
const CLOUD_NAMESPACE='pvz_control_backup';
async function cloudAccount(){
 const api=window.EdPVZAccount;
 if(!api)throw Error('Модуль аккаунта не загружен. Обновите страницу.');
 await api.ensure();
 if(!api.signedIn)throw Error('Для облачной копии войдите в аккаунт Эд ПВЗ в разделе «Аккаунт».');
 return api;
}
function runSync(){
 const api=window.EdPVZAccount;
 syncStatus(api?.signedIn?(window.calendarCloudMessage||'Подключение автоматической синхронизации аккаунта…'):'Данные сохраняются на устройстве. Войдите в аккаунт Эд ПВЗ для облачного резервного копирования.');
}
async function cloudBackup(){
 try{
  const api=await cloudAccount();
  if(storageFault)throw Error('Локальная база повреждена. Не заменяйте ею облачную копию.');
  const raw=localStorage.getItem(KEY);
  if(!raw)throw Error('На устройстве пока нет сохранённой базы.');
  if(raw!==persistedSnapshot)throw Error('Данные изменились в другой вкладке. Обновите страницу.');
  const current=JSON.parse(raw);
  validate(current);
  const existing=await api.load(CLOUD_NAMESPACE);
  if(existing?.payload?.data){
   const at=existing.payload.exported||existing.updated_at||'неизвестно';
   if(!confirm('В облаке уже есть копия от '+at+'. Заменить её текущими данными?'))return;
   const again=await api.load(CLOUD_NAMESPACE);
   if(again?.updated_at!==existing.updated_at)throw Error('Облачная копия изменилась. Повторите операцию после проверки.');
  }
  const payload={app:'PVZ_CONTROL',version:1,exported:new Date().toISOString(),data:current};
  if(JSON.stringify(payload).length>7*1024*1024)throw Error('База слишком большая для этой операции. Скачайте JSON.');
  await api.save(CLOUD_NAMESPACE,payload);
  syncStatus('Облачная резервная копия сохранена: '+new Date().toLocaleString('ru-RU')+'. Автоматическая синхронизация не включена.');
  alert('Облачная копия сохранена в аккаунте Эд ПВЗ.');
 }catch(e){alert('Не удалось сохранить в облако: '+e.message)}
}
async function resolveSync(){
 try{
  const api=await cloudAccount();
  const row=await api.load(CLOUD_NAMESPACE);
  if(!row?.payload?.data)throw Error('В этом аккаунте нет облачной копии PVZ CONTROL.');
  const payload=row.payload;
  if(payload.app!=='PVZ_CONTROL'||payload.version!==1)throw Error('Формат облачной копии не поддерживается.');
  if(!confirm('Восстановить облачную копию от '+(payload.exported||row.updated_at)+'? Перед заменой текущих данных будет предложено скачать их копию.'))return;
  await restore(new File([JSON.stringify(payload)],'PVZ_CONTROL_cloud.json',{type:'application/json'}));
 }catch(e){alert('Не удалось восстановить из облака: '+e.message)}
}
window.addEventListener('edpvz-auth-changed',runSync);
window.addEventListener('storage',e=>{if(e.key===KEY)syncStatus('Данные изменились в другой вкладке. Обновите страницу перед редактированием.')});
window.addEventListener('pvz-saved',()=>runSync());
runSync();

let teamLoading=false,teamLastAttempt=0,teamRevision=0,teamJob=null;
function refreshAccountTeam(force=false){
 if(teamJob)return force?teamJob.then(()=>refreshAccountTeam(true)):teamJob;
 teamJob=loadAccountTeam(force).finally(()=>{teamJob=null});return teamJob;
}
async function loadAccountTeam(force=false){
 const api=window.EdPVZAccount;
 const uid=api?.user?.id||null;
 if(uid!==calendarAccountId){location.reload();return}
 if(!uid||!window.EdPVZCalendarTeam||teamLoading||(!force&&Date.now()-teamLastAttempt<60000))return;
 teamLoading=true;teamLastAttempt=Date.now();const revision=++teamRevision;
 let status=document.getElementById('team-sync-status');
 if(!status){status=document.createElement('p');status.id='team-sync-status';status.setAttribute('role','status');document.querySelector('.market-intro')?.after(status);if(!status.parentNode)document.querySelector('main')?.before(status)}
 status.textContent='Загрузка ПВЗ и подтверждённой команды…';window.calendarTeamMessage=status.textContent;
 try{
  await api.ensure();
  const team=await window.EdPVZCalendarTeam.load(api);
  await synchronizeCalendar();
  if(api.user?.id!==uid||revision!==teamRevision)return;
  if(storageFault)throw Error('Сначала восстановите локальную базу из резервной копии.');
  const merged=window.EdPVZCalendarTeam.merge(db,team);validate(merged);
  if(JSON.stringify(merged)!==JSON.stringify(db)){
   // Write before replacing memory; failed storage or a concurrent tab leaves current data intact.
   writeLocal(JSON.stringify(merged));db=merged;undo=[];redo=[];render();
   if(sheetKind==='day'&&document.querySelector('#sheet-root form'))openSheet('day');
  }
  status.textContent='Команда аккаунта обновлена. ПВЗ: '+team.points.length+' · сотрудников: '+new Set(team.members.filter(m=>m.status==='approved').map(m=>m.user_id)).size+'. Смены и ставки синхронизируются с аккаунтом.';
   window.calendarTeamMessage=status.textContent;const day=document.getElementById('day-team-status');if(day)day.textContent=status.textContent;
 }catch(error){status.textContent='Не удалось обновить команду: '+error.message+' Сохранённые смены и ставки не изменены.'}
 finally{window.calendarTeamMessage=status.textContent;const day=document.getElementById('day-team-status');if(day)day.textContent=status.textContent;teamLoading=false}
}
window.addEventListener('edpvz-auth-changed',()=>refreshAccountTeam(true));
window.addEventListener('focus',()=>refreshAccountTeam());
window.addEventListener('pageshow',()=>refreshAccountTeam());
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshAccountTeam()});
refreshAccountTeam(true);

// Versioned account sync. Local changes are kept during network errors and conflicts.
let calendarCloudBusy=false,calendarCloudReady=false,calendarCloudApplying=false,calendarCloudTimer=null,calendarCloudConflict=null;
function calendarCloudState(){try{return JSON.parse(localStorage.getItem(KEY+'-cloud-base')||'null')}catch{return null}}
function cloudNotice(message){
 window.calendarCloudMessage=message;syncStatus(message);
 const day=document.getElementById('day-team-status');if(day)day.textContent=[window.calendarTeamMessage,message].filter(Boolean).join(' ');
 if(calendarCloudConflict){const panel=document.getElementById('sync-panel');for(const [label,fn] of [['Сохранить эту версию',()=>resolveCalendarConflict('local')],['Загрузить облачную версию',()=>resolveCalendarConflict('remote')]]){const b=document.createElement('button');b.textContent=label;b.onclick=fn;panel?.append(b)}}
}
function applyCalendarData(data){
 validate(data);if(JSON.stringify(data)===JSON.stringify(db))return;
 calendarCloudApplying=true;
 try{writeLocal(JSON.stringify(data));db=JSON.parse(JSON.stringify(data));undo=[];redo=[];render();if(sheetKind==='day'&&document.querySelector('#sheet-root form'))openSheet('day')}
 finally{calendarCloudApplying=false}
}
async function synchronizeCalendar(){
 const api=window.EdPVZAccount,uid=api?.user?.id;
 if(calendarCloudBusy||!uid||uid!==calendarAccountId||!window.EdPVZCalendarCloud||storageFault)return;
 calendarCloudBusy=true;
 try{
  const row=await api.load('pvz_calendar_live');if(api.user?.id!==uid)return;
  const remote=row?.payload||null,baseline=calendarCloudState();
  let candidate=db;
  if(remote?.data){
   validate(remote.data);
   if(baseline?.data){const combined=window.EdPVZCalendarCloud.merge(baseline.data,db,remote.data);if(combined.conflicts.length){calendarCloudConflict={remote,paths:combined.conflicts};cloudNotice('Есть одновременные изменения на двух устройствах. Обе версии сохранены. Выберите версию ниже или скачайте резервные копии.');return}candidate=combined.data}
   else{
    // First connection: union independent local records; never replace conflicting rows silently.
    const combined=window.EdPVZCalendarCloud.merge(empty(),db,remote.data);
    if(combined.conflicts.length){calendarCloudConflict={remote,paths:combined.conflicts};cloudNotice('На устройстве и в облаке есть разные данные. Обе версии сохранены; выберите нужную версию.');return}candidate=combined.data;
   }
  }
  validate(candidate);
  let saved=remote;
  if(!remote||!window.EdPVZCalendarCloud.same(candidate,remote.data)){
   const submitted=JSON.parse(JSON.stringify(candidate));
   saved=await api.rpc('edpvz_calendar_write',{p_revision:remote?.revision||0,p_data:submitted});
   if(api.user?.id!==uid)return;
   if(saved.conflict){cloudNotice('Другое устройство сохранило изменения. Повторяю синхронизацию без перезаписи.');return}
   // If edits happened during the write, keep them for the next sync, merging with the acknowledgement.
   const current=window.EdPVZCalendarCloud.merge(candidate,db,saved.data);
   candidate=current.data;
  }
  if(api.user?.id!==uid)return;
  localStorage.setItem(KEY+'-cloud-base',JSON.stringify(saved));
  applyCalendarData(candidate);calendarCloudReady=true;calendarCloudConflict=null;
  cloudNotice('Автосинхронизация аккаунта включена. Последнее обновление: '+new Date().toLocaleTimeString('ru-RU')+'.');
 }catch(error){cloudNotice('Синхронизация временно недоступна: '+error.message+' Изменения сохранены на этом устройстве и будут отправлены при восстановлении связи.')}
 finally{calendarCloudBusy=false}
}
async function resolveCalendarConflict(choice){
 const conflict=calendarCloudConflict,api=window.EdPVZAccount;if(!conflict||!api?.signedIn)return;
 if(!confirm(choice==='local'?'Сохранить текущую версию в облако? Перед заменой скачайте обе копии.':'Загрузить облачную версию? Текущая копия будет скачана перед заменой.'))return;
 download('PVZ_CONTROL_before_sync_'+Date.now()+'.json',JSON.stringify({app:'PVZ_CONTROL',version:1,data:db}),'application/json');
 if(choice==='local'){
  try{const saved=await api.rpc('edpvz_calendar_write',{p_revision:conflict.remote.revision,p_data:db});if(saved.conflict)return cloudNotice('Облако снова изменилось. Обновите синхронизацию.');localStorage.setItem(KEY+'-cloud-base',JSON.stringify(saved));calendarCloudConflict=null;cloudNotice('Текущая версия сохранена в облако.')}catch(e){cloudNotice(e.message)}
 }else{applyCalendarData(conflict.remote.data);localStorage.setItem(KEY+'-cloud-base',JSON.stringify(conflict.remote));calendarCloudConflict=null;cloudNotice('Облачная версия загружена; предыдущая копия сохранена.')}
}
window.addEventListener('pvz-saved',()=>{if(calendarCloudApplying)return;clearTimeout(calendarCloudTimer);calendarCloudTimer=setTimeout(()=>synchronizeCalendar(),1200)});
window.addEventListener('online',()=>{refreshAccountTeam(true);synchronizeCalendar()});
setInterval(()=>{if(!document.hidden){refreshAccountTeam();synchronizeCalendar()}},15000);

async function restorePreviousCloud(){
 try{
  const api=await cloudAccount(),row=await api.load('pvz_calendar_previous');
  if(!row?.payload?.data)throw Error('Предыдущая облачная версия пока отсутствует.');
  validate(row.payload.data);
  if(!confirm('Восстановить предыдущую облачную версию? Текущая локальная копия будет скачана перед заменой.'))return;
  download('PVZ_CONTROL_before_restore_'+Date.now()+'.json',JSON.stringify({app:'PVZ_CONTROL',version:1,data:db}),'application/json');
  applyCalendarData(row.payload.data);await synchronizeCalendar();
 }catch(error){alert(error.message)}
}
