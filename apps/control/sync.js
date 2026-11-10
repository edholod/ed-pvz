'use strict';
// Local shifts and salary data; confirmed account team is refreshed separately.
// Existing KEY and its saved data are intentionally left unchanged.
function syncStatus(message){
 const status=document.getElementById('sync-status');
 if(status)status.textContent=message;
 let panel=document.getElementById('sync-panel');
 if(!panel){panel=document.createElement('section');panel.id='sync-panel';panel.className='sync-panel';document.querySelector('.app-footer')?.prepend(panel)}
 if(panel){const p=document.createElement('p');p.setAttribute('role','status');p.textContent=message;panel.replaceChildren();const title=document.createElement('strong');title.textContent='Хранение данных';panel.append(title,p);for(const [label,handler] of [['Сохранить копию в облако',cloudBackup],['Восстановить из облака',resolveSync],['Скачать резервную копию JSON',backup],['Скачать исходные данные',downloadRawStorage],['Контрольные копии',localRecovery]]){const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',handler);panel.append(b)}}
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
 syncStatus(api?.signedIn?'Локальные изменения сохраняются на устройстве. Облачная копия создаётся вручную.':'Данные сохраняются на устройстве. Войдите в аккаунт Эд ПВЗ для облачного резервного копирования.');
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

let teamLoading=false,teamLastAttempt=0,teamRevision=0;
async function refreshAccountTeam(force=false){
 const api=window.EdPVZAccount;
 const uid=api?.user?.id||null;
 if(uid!==calendarAccountId){location.reload();return}
 if(!uid||!window.EdPVZCalendarTeam||teamLoading||(!force&&Date.now()-teamLastAttempt<60000))return;
 teamLoading=true;teamLastAttempt=Date.now();const revision=++teamRevision;
 let status=document.getElementById('team-sync-status');
 if(!status){status=document.createElement('p');status.id='team-sync-status';status.setAttribute('role','status');document.querySelector('.market-intro')?.after(status);if(!status.parentNode)document.querySelector('main')?.before(status)}
 status.textContent='Загрузка ПВЗ и подтверждённой команды…';
 try{
  await api.ensure();
  const team=await window.EdPVZCalendarTeam.load(api);
  if(api.user?.id!==uid||revision!==teamRevision)return;
  if(storageFault)throw Error('Сначала восстановите локальную базу из резервной копии.');
  const merged=window.EdPVZCalendarTeam.merge(db,team);validate(merged);
  if(JSON.stringify(merged)!==JSON.stringify(db)){
   // Write before replacing memory; failed storage or a concurrent tab leaves current data intact.
   writeLocal(JSON.stringify(merged));db=merged;undo=[];redo=[];render();
   if(sheetKind==='day'&&document.querySelector('#sheet-root form'))openSheet('day');
  }
  status.textContent='Команда аккаунта обновлена. ПВЗ: '+team.points.length+' · сотрудников: '+new Set(team.members.filter(m=>m.status==='approved').map(m=>m.user_id)).size+'. Смены и ставки сохраняются на устройстве.';
 }catch(error){status.textContent='Не удалось обновить команду: '+error.message+' Сохранённые смены и ставки не изменены.'}
 finally{teamLoading=false}
}
window.addEventListener('edpvz-auth-changed',()=>refreshAccountTeam(true));
window.addEventListener('focus',()=>refreshAccountTeam());
window.addEventListener('pageshow',()=>refreshAccountTeam());
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshAccountTeam()});
refreshAccountTeam(true);
