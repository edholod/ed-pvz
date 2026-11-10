import {MAX_BYTES,makeBackup,validateBackup,inspectBackup,restoreBackup} from './storage.mjs';
const $=id=>document.getElementById(id);let selected=null;
function message(text){$('status').textContent=text}
$('export').onclick=()=>{try{
 const backup=makeBackup(localStorage,location.origin);
 if(!backup.entries.length){message('Локальных данных для переноса не найдено. Облачные данные доступны после входа в аккаунт.');return}
 const url=URL.createObjectURL(new Blob([JSON.stringify(backup)],{type:'application/json'})),a=document.createElement('a');
 a.href=url;a.download='edpvz-local-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
 message('Копия подготовлена: '+backup.entries.length+' записей. Проверьте её наличие в загрузках.');
}catch(e){message(e.message)}};
$('file').onchange=async()=>{selected=null;$('restore').disabled=true;$('preview').replaceChildren();
 try{const file=$('file').files[0];if(!file)return;if(file.size>MAX_BYTES)throw Error('Выберите файл до 8 МБ');
 const backup=validateBackup(JSON.parse(await file.text())),rows=inspectBackup(localStorage,backup);
 for(const row of rows){const li=document.createElement('li');li.textContent=row.key+' — '+({new:'будет добавлено',same:'уже есть',conflict:'отличается, будет пропущено'}[row.state]);$('preview').append(li)}
 selected=backup;$('restore').disabled=!rows.some(row=>row.state==='new');message('Записей: '+rows.length+'. Проверьте состав и нажмите кнопку восстановления.');
 }catch(e){message('Не удалось прочитать копию: '+e.message)}};
$('restore').onclick=()=>{if(!selected)return;try{
 const result=restoreBackup(localStorage,selected);$('restore').disabled=true;selected=null;
 message('Добавлено: '+result.added+'. Пропущено различающихся: '+result.conflicts+'. Заново откройте нужный раздел.');
 }catch(e){message(e.message)}};
