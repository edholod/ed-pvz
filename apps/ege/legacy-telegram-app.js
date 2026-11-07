'use strict';
const app=document.querySelector('#app'),label='WB ЕГЭ · by @edholod';
let tg;
function connectTelegram(){tg=window.Telegram?.WebApp;try{tg?.ready();tg?.expand()}catch{}}
connectTelegram();
document.querySelector('#telegram-sdk')?.addEventListener('load',connectTelegram);
// Read the signed launch payload even when the optional Telegram UI SDK is unavailable.
// Never infer identity from user IDs, initDataUnsafe or locally saved credentials.
function telegramData(){
 connectTelegram();
 if(tg?.initData)return tg.initData;
 try{return new URLSearchParams(window.location.hash.slice(1)).get('tgWebAppData')||''}catch{return ''}
}
const API=String(window.WB_EGE_API||'').replace(/\/+$/,'');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const html=s=>{app.innerHTML=s;window.scrollTo(0,0)};
const button=(title,fn,secondary=false)=>{const b=document.createElement('button');b.type='button';b.className='btn'+(secondary?' secondary':'');b.textContent=title;b.onclick=fn;app.appendChild(b);return b};
const fmt=s=>s?new Date(typeof s==='number'?s*1000:s.replace(' ','T')+'Z').toLocaleDateString('ru-RU',{timeZone:'Europe/Moscow'}):'—';
let questions=[],currentQuestions=[],answers=Array(100).fill(null),idx=0,session=null,result=null,profile=null,dirty=false,saveTimer=null,saveChain=Promise.resolve(),generation=0,busy=false,isAdmin=false,practice=false;
let layoutSeed='',questionOrder=[],optionOrders=[];
const draftKey='wb_ege_draft_compatible_v1';
function keepDraft(){try{if(session)localStorage.setItem(draftKey,JSON.stringify({session,answers,dirty}));else localStorage.removeItem(draftKey)}catch{}}
function restoreDraft(){try{return JSON.parse(localStorage.getItem(draftKey)||'null')}catch{return null}}
function saveLabel(s){const el=document.querySelector('#save-status');if(el)el.textContent=s}
async function api(path,params={}){
 const initData=telegramData();
 if(!initData)throw Error('Telegram не передал данные входа. Закройте окно и откройте тест кнопкой под сообщением бота.');
 let response;try{response=await fetch(API+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...params,bankVersion:questions[0]?.bankVersion||'',initData})})}catch{throw Error('Нет соединения с сервером. Ответы остаются в этом окне.')}
 let data;try{data=await response.json()}catch{throw Error('Сервер вернул некорректный ответ')}
 if(!response.ok)throw Object.assign(Error(data.error||'Ошибка сервера'),{status:response.status});return data;
}
function errorPage(e,retry){html(`<div class="brand">${label}</div><div class="card" role="alert"><h2>Не удалось выполнить действие</h2><p>${esc(e.message||e)}</p></div>`);if(retry)button('Повторить действие',retry);if(session)button('Вернуться к вопросам',question,true);button('На главную',home,true)}
function enqueueSave(){
 if(!session)return Promise.resolve();clearTimeout(saveTimer);
 const id=session,snapshot=[...answers],seq=generation;
 saveChain=saveChain.catch(()=>{}).then(async()=>{const r=await api('/save',{sessionId:id,answers:snapshot});if(r.saved!==true)throw Error('Сервер не подтвердил сохранение');if(session===id&&generation===seq){dirty=false;keepDraft();saveLabel('Сохранено на сервере')}return r});
 return saveChain;
}
function scheduleSave(){dirty=true;keepDraft();saveLabel('Сохраняем…');clearTimeout(saveTimer);saveTimer=setTimeout(()=>enqueueSave().catch(e=>saveLabel('Не сохранено: '+e.message)),450)}
async function flushSave(){clearTimeout(saveTimer);await saveChain;if(dirty)await enqueueSave();}


// Only the presentation is shuffled. Answers always use the original bank indices.
// A saved attempt ID reproduces the same layout on every device.
function layoutRandom(seed){
 let a=0x9e3779b9,b=0x243f6a88,c=0xb7e15162,d=0xdeadbeef;
 for(const ch of seed){const n=ch.charCodeAt(0);a=Math.imul(a^n,2654435761);b=Math.imul(b^n,1597334677);c=Math.imul(c^n,2246822507);d=Math.imul(d^n,3266489909);}
 const next=()=>{a>>>=0;b>>>=0;c>>>=0;d>>>=0;let t=(a+b)|0;a=b^(b>>>9);b=(c+(c<<3))|0;c=(c<<21)|(c>>>11);d=(d+1)|0;t=(t+d)|0;c=(c+t)|0;return (t>>>0)/4294967296;};
 for(let i=0;i<16;i++)next();return next;
}
function setLayout(seed){
 layoutSeed=seed;const random=layoutRandom('wb-ege-layout-v1:'+seed);
 const shuffled=n=>{const a=Array.from({length:n},(_,i)=>i);for(let i=n-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
 questionOrder=shuffled(questions.length);optionOrders=questions.map(q=>shuffled(q.options.length));
}
function firstUnanswered(){return questionOrder.findIndex(i=>answers[i]===null);}

function readableQuestions(serverQuestions){if(!serverQuestions)return questions;const same=serverQuestions.length===currentQuestions.length&&serverQuestions.every((q,i)=>q.id===currentQuestions[i]?.id&&q.bankVersion===currentQuestions[i]?.bankVersion&&q.options?.length===currentQuestions[i]?.options?.length);return same?currentQuestions:serverQuestions;}
function loadAttempt(a){practice=false;questions=readableQuestions(a.questions);session=a.id;setLayout('attempt:'+session);answers=a.answers;const d=restoreDraft();if(d?.session===session&&d.dirty&&Array.isArray(d.answers)&&d.answers.length===100){if(confirm('Найдены ответы, не подтверждённые сервером. Восстановить их из этого устройства?')){answers=d.answers;dirty=true;generation++;}else{dirty=false;keepDraft()}}else{dirty=false;keepDraft()}
 idx=firstUnanswered();if(idx<0)idx=questions.length-1;question();if(dirty)scheduleSave();}
async function home(){
 if(!telegramData()){
  let inside=false;try{inside=!!tg?.platform&&tg.platform!=='unknown'||new URLSearchParams(window.location.hash.slice(1)).has('tgWebAppPlatform')}catch{}
  html(`<div class="brand">${label}</div><div class="card"><h1>${inside?'Telegram не передал данные входа':'Откройте WB ЕГЭ из Telegram'}</h1><p>${inside?'Закройте это окно и откройте тест кнопкой под сообщением бота. Кнопка обычной клавиатуры Telegram может открывать приложение без данных участника.':'Откройте бота @edholod_wbbot и нажмите WebApp-кнопку теста под сообщением.'}</p><p class="muted">Код: ${inside?'TG_LAUNCH_EMPTY':'TG_BROWSER'} · версия входа 20261102. Если ошибка повторится, отправьте этот код автору бота.</p></div>`);
  button('Проверить вход ещё раз',home);return;
 }
 try{const s=await api('/status');if(s.bankVersion!==currentQuestions[0]?.bankVersion)throw Error('Обновите страницу: сайт и сервер разных редакций вопросов');isAdmin=s.isAdmin===true;html(`<div class="brand">${label}</div><div class="card"><span class="pill">Независимая аттестация сотрудников ПВЗ</span><h1>WB ЕГЭ</h1><p>100 рабочих ситуаций. В каждой выберите один правильный ответ с учётом всех условий. В новой попытке вопросы и варианты перемешиваются. 90–99 баллов — серебряный сертификат, 100 баллов — золотой.</p><p class="muted">Новая попытка через 24 часа после начала предыдущей. Это не официальный экзамен Wildberries.</p></div>`);
 if(s.active){html(app.innerHTML+'<div class="card"><h2>Незавершённый экзамен</h2><p>Можно продолжить сохранённую попытку.</p></div>');button('Продолжить экзамен',()=>loadAttempt(s.active))}
 else if(s.cooldownSeconds>0){html(app.innerHTML+`<div class="card"><h2>Следующая попытка позже</h2><p>Осталось примерно ${Math.ceil(s.cooldownSeconds/60)} мин.</p></div>`)}
 else{html(app.innerHTML+`<div class="card"><h2>Данные участника</h2><label for="fio">ФИО</label><input id="fio" class="field" maxlength="140" placeholder="Иванов Иван Иванович" autocomplete="name"><label for="dob">Дата рождения</label><input id="dob" class="field" type="date" max="${new Date().toISOString().slice(0,10)}"><label class="consent"><input type="checkbox" id="consent"> Согласен на обработку ФИО, даты рождения и результата. При проверке сертификата будут публично видны ФИО и результат.</label></div>`);button('Начать экзамен',start)}
 if(isAdmin)button('Режим тестирования · без ограничений',startPractice,true);
 if(s.lastScore!==null)button('Последний результат и ошибки',previousResult,true);button('Мои сертификаты',certificates,true);
 }catch(e){errorPage(e,home)}}
function startPractice(){
 if(!isAdmin)return;questions=currentQuestions;practice=true;session=null;answers=Array(100).fill(null);idx=0;dirty=false;result=null;setLayout('practice:'+crypto.randomUUID());question();
}
async function start(){if(busy)return;const fio=document.querySelector('#fio')?.value.trim(),dob=document.querySelector('#dob')?.value,consent=document.querySelector('#consent')?.checked;if(!fio||!dob||!consent){alert('Заполните ФИО, дату рождения и согласие');return}busy=true;questions=currentQuestions;practice=false;try{const r=await api('/start',{fio,dob,consent});profile={fio,dob};questions=readableQuestions(r.questions);session=r.sessionId;setLayout('attempt:'+session);answers=r.answers;dirty=false;generation=0;keepDraft();idx=0;question()}catch(e){errorPage(e,home)}finally{busy=false}}
function question(){const qi=questionOrder[idx],q=questions[qi];if(!q)return errorPage(Error('Не удалось загрузить вопрос'),home);
 html(`<div class="brand">${label}</div><div class="flex"><b>${practice?'Тестовый режим · ':''}Вопрос ${idx+1} / 100</b><span>${answers.filter(x=>x!==null).length} ответов</span></div><div class="progress"><div style="width:${answers.filter(x=>x!==null).length}%"></div></div><div class="card"><span class="pill">${esc(q.category)}</span><h2>${esc(q.question)}</h2><div id="choices"></div><p id="save-status" class="muted">${practice?'Пробная попытка не сохраняется и не влияет на сертификаты':dirty?'Есть несохранённые изменения':'Ответы сохраняются на сервере'}</p></div>`);
 const choices=document.querySelector('#choices');optionOrders[qi].forEach((i,displayIndex)=>{const o=q.options[i];const b=document.createElement('button');b.type='button';b.className='option'+(answers[qi]===i?' selected':'');b.textContent=String.fromCharCode(65+displayIndex)+'. '+o;b.onclick=()=>{answers[qi]=i;generation++;if(!practice)scheduleSave();question()};choices.appendChild(b)});
 const next=button(idx===99?'Завершить экзамен':'Следующий вопрос',idx===99?finish:()=>{idx++;question()});next.disabled=answers[qi]===null;
 if(idx>0)button('Предыдущий вопрос',()=>{idx--;question()},true);
 button('К первому пропущенному',()=>{const n=firstUnanswered();if(n<0)alert('Все вопросы отвечены');else{idx=n;question()}},true);
 if(practice){button('Выйти из тестового режима',()=>{practice=false;answers=Array(100).fill(null);home()},true);return;}
 button('Сохранить сейчас',async()=>{try{await flushSave();saveLabel('Сохранено на сервере')}catch(e){saveLabel('Ошибка: '+e.message)}},true);
 button('Сохранить и на главную',async()=>{try{await flushSave();await home()}catch(e){errorPage(e,question)}},true);
}
async function finish(){if(busy)return;if(answers.some(x=>x===null)){alert('Нужно ответить на все 100 вопросов');return}if(!confirm('Завершить экзамен? Ответы больше нельзя будет изменить.'))return;busy=true;try{if(practice){result=await api('/practice-check',{answers:[...answers]});practice=false;showResult();return;}await flushSave();result=await api('/finish',{sessionId:session,answers:[...answers]});dirty=false;session=null;keepDraft();showResult()}catch(e){errorPage(e,finish)}finally{busy=false}}
function showResult(){const r=result;if(r.questions)questions=readableQuestions(r.questions);html(`<div class="brand">${label}</div><div class="card"><div class="result">${r.score}/100</div><h2>${r.practice?'Пробный экзамен · без сертификата':r.level==='gold'?'Золотой результат':r.level==='silver'?'Серебряный результат':'Экзамен завершён'}</h2><p>Ошибок: ${100-r.score}</p></div>`);
 const misses=[...(r.review||[])];if(layoutSeed)misses.sort((a,b)=>questionOrder.indexOf(a.i)-questionOrder.indexOf(b.i));html(app.innerHTML+`<h2>Разбор ошибок (${misses.length})</h2>`+(misses.length?misses.map(m=>{const q=questions[m.i];return `<div class="card bad"><h2>${layoutSeed?questionOrder.indexOf(m.i)+1+'. ':''}${esc(q.question)}</h2><p>Ваш ответ: ${esc(q.options[answers[m.i]])}</p><p><b>Правильный ответ:</b> ${esc(q.options[m.correct])}</p><p>${esc(m.explanation)}</p>${m.optionExplanations?.length?`<details><summary>Почему остальные варианты не подходят</summary><ol>${q.options.map((o,i)=>`<li><b>${esc(o)}</b><br>${esc(m.optionExplanations[i])}</li>`).join('')}</ol></details>`:''}${(m.sources||[]).map(s=>`<p class="muted"><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a><br>${esc(s.date)} · ${esc(s.loc)}</p>`).join('')}<p class="muted">Тема: ${esc(q.lesson)}</p></div>`}).join(''):'<div class="card good">Все ответы правильные!</div>'));
 if(r.certificate)certificate(r.certificate);if(r.practice)button('Пройти пробный экзамен ещё раз',startPractice);button('Мои сертификаты',certificates,true);button('На главную',home,true)}
function certificate(c){const url=API+c.verificationUrl;const el=document.createElement('div');el.className='card';el.innerHTML=`<div id="certificate" class="cert ${c.level==='gold'?'gold':''}"><div class="brand">WB ЕГЭ · by @edholod</div><h2>${c.level==='gold'?'ЗОЛОТОЙ':'СЕРЕБРЯНЫЙ'} СЕРТИФИКАТ</h2><p>Независимая учебная аттестация сотрудников ПВЗ</p><div class="name">${esc(profile?.fio||'Участник')}</div><p>Результат: ${c.score}/100</p><img id="certqr" alt="QR проверки сертификата"><p>№ ${esc(c.number)}</p><p class="muted">Не является официальным документом Wildberries</p></div>`;app.appendChild(el);el.querySelector('#certqr').src='https://api.qrserver.com/v1/create-qr-code/?size=240x240&data='+encodeURIComponent(url);button('Печать / сохранить PDF',()=>window.print());button('Проверить сертификат',()=>tg?.openLink?tg.openLink(url):window.open(url,'_blank','noopener,noreferrer'),true)}
async function previousResult(){try{const r=await api('/result');layoutSeed='';questionOrder=[];optionOrders=[];session=null;result=r;answers=r.answers;showResult()}catch(e){errorPage(e,previousResult)}}
async function certificates(){try{const r=await api('/my-certificates');html(`<div class="brand">${label}</div><h1>Мои сертификаты</h1>`+(r.certificates.length?r.certificates.map(c=>`<div class="card"><h2>${c.level==='gold'?'Золотой':'Серебряный'} · ${c.score}/100</h2><p>Выдан: ${fmt(c.issuedAt)}</p><a href="${esc(API+c.verificationUrl)}" target="_blank" rel="noopener noreferrer">Проверить сертификат</a></div>`).join(''):'<div class="card">Пока нет сертификатов</div>'));button('На главную',home,true)}catch(e){errorPage(e,certificates)}}
window.addEventListener('beforeunload',e=>{if(dirty){keepDraft();e.preventDefault();e.returnValue=''}});
fetch('questions.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Вопросы не загружены');return r.json()}).then(q=>{if(!Array.isArray(q)||q.length!==100)throw Error('Ожидалось 100 вопросов');questions=q;currentQuestions=q;home()}).catch(e=>errorPage(e,()=>location.reload()));
