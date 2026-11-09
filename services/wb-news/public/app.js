'use strict';
const $ = id => document.getElementById(id);
let refreshing=false,authenticated=false;
const labels = {starting:'Запуск',ok:'Сбор работает',partial:'Один раздел временно недоступен',access_denied:'WB сообщает «Раздел недоступен». Проверьте выбранную организацию и её доступ к новостям.',unavailable:'Источник временно недоступен',authentication_required:'Нужно войти в WB',manual_login:'Ожидается завершение входа',blocked:'WB ограничил доступ. Автоматический сбор остановлен',browser_failed:'Браузер не запущен — проверьте состояние сервера'};
async function request(url, data) {
  const response = await fetch(url, {...(data === undefined ? {} : {method:'POST',body:new URLSearchParams(data)}),credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(20000)});
  let result;try{result=await response.json()}catch{throw new Error('Сервер временно недоступен. Повторяем соединение…')}
  if (!response.ok) {const error=new Error(result.error || 'Запрос не выполнен');error.status=response.status;throw error}
  return result;
}
async function refresh() {
  if(refreshing)return;refreshing=true;
  try {
    const data = await request('/admin/status');
    authenticated=true;
    $('login').hidden = true; $('controls').hidden = false;
    $('state').textContent = (labels[data.state] || data.state) + '\nНовостей: ' + data.count + '\nПоследний сбор: ' + (data.updated ? new Date(data.updated).toLocaleString('ru-RU') : 'ещё не выполнен');
    $('desktop').hidden = !data.controlOpen;
    const report = $('dispute-report');
    if(report){const check=data.disputeInspection||{};report.textContent='Проверка удержаний и тикетов: '+(check.state||'не запускалась')+'\n'+(check.lastAttempt?new Date(check.lastAttempt).toLocaleString('ru-RU'):'')+'\n'+(check.sections||[]).map(x=>(x.category||({brak:'Брак',podmena:'Подмена',hanging:'Зависшие',violations:'Штрафы',tickets:'Тикеты'}[x.key]||x.key))+' ('+x.key+'): '+x.state).join('\n');}
    if($('message').dataset.connection==='retry'){$('message').textContent='';delete $('message').dataset.connection}
  } catch(error) {
    if(error.status===401){$('login').hidden=false;$('controls').hidden=true;if(authenticated)$('message').textContent='Сессия управления завершилась. Введите ключ снова.';authenticated=false}
    else {$('message').textContent='Связь с сервером прервалась. Повторяем подключение; повторно вводить ключ пока не нужно.';$('message').dataset.connection='retry'}
  } finally {refreshing=false}
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

if($('inspect-disputes')) $('inspect-disputes').onclick=act(()=>request('/admin/inspect-disputes',{}));

