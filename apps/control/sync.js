'use strict';
// Standalone Ed PVZ calendar. No Telegram authentication, API calls or account switching.
// Existing KEY and its saved data are intentionally left unchanged.
function syncStatus(message){
 const status=document.getElementById('sync-status');
 if(status)status.textContent=message;
 let panel=document.getElementById('sync-panel');
 if(!panel){panel=document.createElement('section');panel.id='sync-panel';panel.className='sync-panel';document.querySelector('.app-footer')?.prepend(panel)}
 if(panel)panel.innerHTML='<strong>Хранение данных</strong><p role="status">'+message+'</p><button type="button" onclick="backup()">Скачать резервную копию JSON</button><button type="button" onclick="downloadRawStorage()">Скачать исходные данные</button><button type="button" onclick="localRecovery()">Контрольные копии</button>';
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
function runSync(){syncStatus('Данные сохраняются на этом устройстве. Облачная синхронизация будет доступна после подключения аккаунтов Эд ПВЗ.')}
function cloudBackup(){alert('Облачные копии будут доступны после подключения аккаунта Эд ПВЗ.')}
function resolveSync(){alert('Облачная синхронизация пока не подключена.')}
window.addEventListener('storage',e=>{if(e.key===KEY)syncStatus('Данные изменились в другой вкладке. Обновите страницу перед редактированием.')});
window.addEventListener('pvz-saved',()=>syncStatus('Изменения сохранены на этом устройстве.'));
runSync();
