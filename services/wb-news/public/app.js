'use strict';
const $ = id => document.getElementById(id);
const labels = {starting:'Запуск',ok:'Сбор работает',partial:'Один раздел временно недоступен',access_denied:'WB сообщает «Раздел недоступен». Проверьте выбранную организацию и её доступ к новостям.',unavailable:'Источник временно недоступен',authentication_required:'Нужно войти в WB',manual_login:'Ожидается завершение входа',blocked:'WB ограничил доступ. Автоматический сбор остановлен',browser_failed:'Браузер не запущен — проверьте состояние сервера'};
async function request(url, data) {
  const response = await fetch(url, data === undefined ? {} : {method:'POST',body:new URLSearchParams(data)});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Запрос не выполнен');
  return result;
}
async function refresh() {
  try {
    const data = await request('/admin/status');
    $('login').hidden = true; $('controls').hidden = false;
    $('state').textContent = (labels[data.state] || data.state) + '\nНовостей: ' + data.count + '\nПоследний сбор: ' + (data.updated ? new Date(data.updated).toLocaleString('ru-RU') : 'ещё не выполнен');
    $('desktop').hidden = !data.controlOpen;
  } catch { $('login').hidden = false; $('controls').hidden = true; }
}
function act(fn) {return async event => {event?.preventDefault();$('message').textContent='';try{await fn();await refresh()}catch(error){$('message').textContent=error.message}}}
$('login').onsubmit = act(async()=>{await request('/admin/login',{token:$('token').value});$('token').value=''});
$('begin').onclick = act(()=>request('/admin/begin',{}));
$('finish').onclick = act(()=>request('/admin/finish',{}));
$('export').onclick = act(async()=>{
  const response=await fetch('/admin/export-session',{method:'POST'});
  if(!response.ok)throw Error('Сначала завершите вход в WB и дождитесь успешного получения новостей.');
  const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='WB_SESSION.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('logout').onclick = act(()=>request('/admin/logout',{}));
refresh();setInterval(refresh,10000);
