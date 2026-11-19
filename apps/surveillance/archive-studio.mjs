import {revealPlayer,setLoading} from './player-interface.mjs?v=1';
const WORKER = 'https://edpvz-archive.onrender.com';
const $ = (node, query) => node.querySelector(query);
const stamp = seconds => new Date(seconds * 1000).toLocaleString('ru-RU');
const duration = seconds => {
  const hours = Math.floor(seconds / 3600);
  return [hours, Math.floor(seconds / 60) % 60, Math.floor(seconds) % 60].map(x => String(x).padStart(2, '0')).join(':');
};
const dateValue = seconds => {
  const date = new Date(seconds * 1000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
};
export function splitIntervals(start, end, maxSeconds = 900) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start || maxSeconds <= 0) throw Error('Некорректный интервал');
  const result = [];
  for (let at = start; at < end; at += maxSeconds) result.push([at, Math.min(end, at + maxSeconds)]);
  return result;
}
export function createArchiveStudio(options) {
  const {video, live, liveName, status, records, playHls, stopPlayback} = options;
  const root = document.createElement('section');
  root.className = 'archive-studio';
  root.hidden = true;
  root.innerHTML = `
    <header class="as-head"><h2>Период записи</h2><span class="as-zone"></span></header>
    <p class="as-note as-service-state" role="status" hidden></p>
    <div class="as-inputs">
      <label>Начало<input class="as-start" type="datetime-local" step="1"></label>
      <label>Конец<input class="as-end" type="datetime-local" step="1"></label>
    </div>
    <div class="as-actions">
      <button type="button" class="primary as-original">Подготовить MP4</button>
      <button type="button" class="secondary as-save-yandex" hidden>Сохранить на Яндекс Диск</button>
      <button type="button" class="secondary as-preview">Посмотреть</button>
    </div>
    <div class="as-current as-card" hidden></div>
    <p class="as-feedback" role="status"></p>
    <details class="as-options">
      <summary>Дополнительные настройки</summary>
      <div class="as-inputs">
        <label>Название фрагмента<input class="as-name" maxlength="100" placeholder="Например, Отказ клиента"></label>
        <label>Качество просмотра<select class="as-profile"><option value="auto">До 720p</option><option value="high">Исходное разрешение</option><option value="low">До 480p</option></select></label>
        <label>Качество файла<select class="as-output"><option value="source">Исходное разрешение</option><option value="1080">До 1080p</option><option value="720">До 720p</option><option value="480">До 480p</option></select></label>
      </div>
      <details class="as-day"><summary>Выбрать на шкале дня</summary>
        <label>День<input class="as-date" type="date"></label>
        <label>Начало на шкале <output class="as-from-text"></output><input class="as-from" aria-label="Начало на шкале" type="range" min="0" max="86399" step="1" value="32400"></label>
        <label>Конец на шкале <output class="as-to-text"></output><input class="as-to" aria-label="Конец на шкале" type="range" min="1" max="86400" step="1" value="32700"></label>
      </details>
      <div class="as-actions">
        <button type="button" class="secondary as-mark-start">Начало по текущему кадру</button>
        <button type="button" class="secondary as-mark-end">Конец по текущему кадру</button>
        <button type="button" class="secondary as-frame">Сохранить кадр</button>
        <button type="button" class="secondary as-add">Добавить фрагмент</button>
      </div>
      <h3>Фрагменты к подготовке</h3><div class="as-clips"></div>
      <div class="as-actions"><button type="button" class="primary as-build">Подготовить файлы</button></div>
      <p><a href="https://my.ivideon.com/exported_records" target="_blank" rel="noopener noreferrer">Готовые записи в Ivideon ↗</a></p>
      <p><a href="./#cloud-settings">Настройки облачных дисков</a></p>
    </details>`;
  live.insertBefore(root, video);
  const get = name => $(root, '.as-' + name);
  const originalStatus = document.createElement('p');
  originalStatus.setAttribute('role','status');
  const originalFiles = document.createElement('ul');
  originalFiles.className = 'shortcut-list archive-original-files';
  records.querySelector('.as-jobs').before(originalFiles);
  const importPanel = document.createElement('details');
  const importTitle = document.createElement('summary');
  importTitle.textContent = 'Склеить скачанные MP4 и сохранить на Яндекс Диск';
  const importInput = document.createElement('input');
  importInput.type = 'file'; importInput.accept = 'video/mp4,.mp4'; importInput.multiple = true;
  importInput.setAttribute('aria-label','Части MP4');
  const importInfo = document.createElement('p');
  const importStatus = document.createElement('p');
  importStatus.setAttribute('role','status');
  importInput.addEventListener('change',()=>{
    importInfo.textContent = [...importInput.files].sort((a,b)=>a.name.localeCompare(b.name,'ru',{numeric:true})).map(f=>f.name).join(' → ');
  });
  const merge = document.createElement('button');
  merge.type = 'button'; merge.className = 'secondary'; merge.textContent = 'Склеить и сохранить';
  merge.addEventListener('click',async()=>{
    const files = [...importInput.files].sort((a,b)=>a.name.localeCompare(b.name,'ru',{numeric:true}));
    merge.disabled = true;
    let job;
    try {
      if (!loaded) throw Error('Дождись загрузки списка заданий.');
      const owner = user;
      job = await request('/jobs/import',{sizes:files.map(f=>f.size),name:get('name').value.trim()});
      for (const [i,file] of files.entries()) {
        if (owner !== user) return;
        importStatus.textContent = 'Загружаем часть '+(i+1)+' из '+files.length+'…';
        Object.assign(job,await request('/jobs/'+job.id+'/import/'+i,file));
      }
      if (owner !== user) return;
      jobs.unshift(job); persist(); drawJobs(); schedule();
      importStatus.textContent = 'Части загружены. Один MP4 появится во вкладке «Список архивов».';
    } catch (error) {
      if (job) await request('/jobs/'+job.id+'/cancel',{}).catch(()=>{});
      importStatus.textContent = error.message || 'Не удалось загрузить части.';
    } finally { merge.disabled = false; }
  });
  importPanel.append(importTitle,'Порядок склейки определяется именами файлов. ',importInput,importInfo,merge,importStatus);
  get('original').parentElement.after(originalStatus);
  get('options').append(importPanel);
  get('original').addEventListener('click', async () => {
    const originalButton = get('original');
    setLoading(originalButton,true);
    const owner = user;
    try {
      const {start,end} = interval();
      if (!camera) throw Error('Выбери камеру.');
      const selected = camera;
      const {id:cameraId, connectionId} = selected;
      if (end-start > 18000) {
        const health = await request('/health');
        if (!health.ok || !health.exportReady || !health.temporaryDiskConfigured) {
          throw Error('Сборка одного файла через Яндекс Диск временно недоступна.');
        }
        if (owner !== user) return;
        const cameraName = selected.displayName || selected.name;
        originalStatus.textContent = 'Отправляем длинную запись на сборку…';
        const job = await request('/jobs',{
          clips:[{cameraId,connectionId,cameraName,start,end,name:get('name').value.trim() || cameraName+' '+stamp(start)}],
          quality:get('output').value,profile:get('profile').value,requestId:crypto.randomUUID()
        });
        if (owner !== user) return;
        jobs.unshift(job); persist(); drawJobs(); schedule();
        originalStatus.textContent = 'Задание принято. Один MP4 появится в готовых файлах.';
        return;
      }
      const parts = [[start,end]];
      const requestExport = archive => window.EdPVZAccount.checkIvideon(undefined,cameraId,undefined,'load',{...archive,connectionId});
      const getStatus = (exportId,share=false) => requestExport({mode:'export-status',exportId,browserDownload:true,share});
      for (const [index,[from,to]] of parts.entries()) {
        originalStatus.textContent = 'Ivideon готовит один MP4 за выбранный период…';
        const {exportId} = await requestExport({mode:'export',start:from,end:to});
        if (!exportId) throw Error('Ivideon не начал экспорт.');
        const deadline = Date.now() + 600000;
        let result;
        while (Date.now() < deadline) {
          if (owner !== user) return;
          result = await getStatus(exportId);
          if (owner !== user) return;
          if (result.state === 'ready') break;
          if (result.state === 'failed') throw Error('Ivideon не подготовил часть ' + (index+1) + '.');
          await new Promise(resolve => setTimeout(resolve,3000));
        }
        if (result?.state !== 'ready') throw Error('Ivideon ещё готовит часть ' + (index+1) + '. Она появится в кабинете Ivideon.');
        const row = document.createElement('li');
        const link = document.createElement('a');
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Скачать MP4 · ' + stamp(from) + ' — ' + stamp(to);
        function assignDownload(data) {
          const url = new URL(data.downloadUrl);
          if (url.origin !== 'https://duerixyhzapotoeclggz.supabase.co' ||
              url.pathname !== '/functions/v1/edpvz-ivideon-check' || !url.searchParams.has('download')) {
            throw Error('Получен неверный адрес файла.');
          }
          link.href = url.href;
        }
        assignDownload(result);
        const refresh = document.createElement('button');
        refresh.type = 'button';
        refresh.className = 'secondary';
        refresh.textContent = 'Обновить ссылку';
        refresh.addEventListener('click', async () => {
          refresh.disabled = true;
          try {
            const fresh = await getStatus(exportId);
            if (fresh.state !== 'ready') throw Error('Файл больше недоступен. Подготовь его заново.');
            assignDownload(fresh);
            originalStatus.textContent = 'Ссылка обновлена.';
          } catch (error) {
            originalStatus.textContent = error.message || 'Не удалось обновить ссылку на MP4.';
          } finally {
            refresh.disabled = false;
          }
        });
        const share = button('Скопировать ссылку',async()=>{
          const shared = await getStatus(exportId,true);
          if (shared.state !== 'ready') throw Error('Файл больше недоступен.');
          await copyShare(shared.downloadUrl,originalStatus);
        });
        const send = button('В Эдсенджер',async()=>{
          const shared = await getStatus(exportId,true);
          if (shared.state !== 'ready') throw Error('Файл больше недоступен.');
          sendToMessenger(shared.downloadUrl);
        });
        row.append(link,' ',refresh,' ',share,' ',send);
        originalFiles.prepend(row);
        drawJobs();
      }
      originalStatus.textContent = 'MP4 готов. Открой «Список архивов», чтобы скачать файл.';
    } catch (error) {
      originalStatus.textContent = error.message || 'Не удалось подготовить исходный MP4.';
    } finally {
      setLoading(originalButton,false);
    }
  });
  get('zone').textContent = 'Время устройства · ' + Intl.DateTimeFormat().resolvedOptions().timeZone;
  const account = () => window.EdPVZAccount;
  let camera, playback, previewStart, previewBase = 0, user, generation = 0, poll, saving;
  let clips = [], jobs = [], loaded = false, config;
  const urls = new Set();
  const feedback = text => { (root.hidden ? records.querySelector('.as-records-feedback') : get('feedback')).textContent = text; };
  const request = (path, body) => account().archiveRequest(path, body);
  function button(text, fn) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'secondary'; b.textContent = text;
    b.addEventListener('click', async () => {
      setLoading(b,true);
      try { await fn(); } catch (error) { feedback(error.message || 'Операция не выполнена.'); }
      finally { setLoading(b,false); }
    });
    return b;
  }
  function persist() {
    if(!loaded){feedback('Очередь ещё загружается. Повтори действие после восстановления соединения.');return;}
    clearTimeout(saving);
    const owner = user;
    saving = setTimeout(() => {
      if (owner !== user || account()?.user?.id !== owner) return;
      account().save('ivideon-archive-project', {clips, jobs: jobs.map(job => {
        const {id,title,destination,state,message,cloudFiles,cameraName,start,end} = job;
        return destination === 'yandex' && state === 'ready'
          ? {id,title,destination,state,message,cloudFiles,cameraName,start,end}
          : {id,title:title || 'Архив',destination};
      })}).catch(() => feedback('Не удалось сохранить очередь в аккаунте.'));
    }, 300);
  }
  function interval() {
    const start = Math.floor(new Date(get('start').value).getTime() / 1000);
    const end = Math.floor(new Date(get('end').value).getTime() / 1000);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start <= 0 || end <= start || end > Date.now()/1000) throw Error('Выбери начало и конец в прошлом. Конец должен быть позже начала.');
    return {start, end};
  }
  function syncTimeline() {
    const start = new Date(get('start').value), end = new Date(get('end').value);
    if (!Number.isFinite(start.getTime())) return;
    get('date').value = dateValue(start.getTime()/1000).slice(0,10);
    const from = start.getHours()*3600 + start.getMinutes()*60 + start.getSeconds();
    const to = start.toDateString() === end.toDateString() ? end.getHours()*3600 + end.getMinutes()*60 + end.getSeconds() : 86400;
    get('from').value = from; get('to').value = Math.max(from+1,to);
    get('from').setAttribute('aria-valuetext',duration(from));get('to').setAttribute('aria-valuetext',duration(Math.max(from+1,to)));
    get('from-text').textContent = duration(from); get('to-text').textContent = duration(Math.max(from+1,to));
  }
  function applyTimeline() {
    const day = new Date(get('date').value+'T00:00:00');
    const from = Number(get('from').value), to = Math.max(from+1, Number(get('to').value));
    get('to').value = to;
    get('start').value = dateValue(day.getTime()/1000 + from);
    get('end').value = dateValue(day.getTime()/1000 + to);
    get('from').setAttribute('aria-valuetext',duration(from));get('to').setAttribute('aria-valuetext',duration(Math.max(from+1,to)));
    get('from-text').textContent = duration(from); get('to-text').textContent = duration(to);
  }
  for (const field of ['from','to','date']) get(field).addEventListener('input',applyTimeline);
  for (const field of ['start','end']) get(field).addEventListener('change',syncTimeline);
  let previewPending = false, previewTimer;
  function previewLoading(loading) {
    previewPending = loading;
    clearTimeout(previewTimer);
    setLoading(get('preview'),loading);
    if (loading) status.setAttribute('aria-busy','true');
    else status.removeAttribute('aria-busy');
  }
  function stop() {
    playback?.(); playback = undefined;
  }
  async function preview() {
    if(!camera)return;
    if(!loaded)throw Error('Подожди загрузки сохранённых фрагментов.');
    const {start,end}=interval();
    const active=++generation,chosen={...camera},owner=user;
    stop();stopPlayback();
    previewStart=undefined;
    previewLoading(true);
    status.textContent='Подготавливаем видео для просмотра…';
    revealPlayer(live);
    await ensureWorker();
    if (active!==generation || owner!==user) return;
    const job=await request('/jobs',{clips:[{cameraId:chosen.id,connectionId:chosen.connectionId,cameraName:chosen.displayName||chosen.name,start,end,name:'Просмотр '+(chosen.displayName||chosen.name)}],quality:get('profile').value==='low'?'480':get('profile').value==='high'?'source':'720',profile:get('profile').value,requestId:crypto.randomUUID()});
    if(owner!==user)return;
    if(active===generation)job.previewGeneration=active;
    jobs.unshift(job);persist();drawJobs();schedule();
  }
  video.addEventListener('loadeddata',()=>{
    if (!previewPending || previewStart===undefined) return;
    previewLoading(false);
    status.textContent='Запись готова к просмотру.';
  });
  video.addEventListener('error',()=>{
    if (!previewPending || previewStart===undefined) return;
    previewLoading(false);
    status.textContent='Не удалось загрузить видео в плеере.';
  });
  video.addEventListener('loadedmetadata',() => {
    if (previewStart !== undefined) previewBase = video.seekable.length ? video.seekable.start(0) : 0;
  });
  function mark(field) {
    if (previewStart === undefined || !video.videoWidth) throw Error('Сначала открой запись и выбери кадр в плеере.');
    const absolute = previewStart + Math.max(0,Math.floor(video.currentTime-previewBase));
    get(field).value = dateValue(absolute); syncTimeline();
  }
  function drawClips() {
    const box = get('clips'); box.replaceChildren();
    if (!clips.length) { box.textContent = 'Добавь один или несколько фрагментов.'; return; }
    clips.forEach((clip,index) => {
      const row = document.createElement('article'); row.className = 'as-card';
      const title = document.createElement('input'); title.value=clip.name;title.maxLength=100;title.setAttribute('aria-label','Название фрагмента');
      title.addEventListener('change',()=>{clip.name=title.value.trim()||'Запись';persist();});
      const text = document.createElement('p');text.textContent=(clip.cameraName||'Камера')+' · '+stamp(clip.start)+' — '+stamp(clip.end)+' · '+duration(clip.end-clip.start);
      row.append(title,text,button('Убрать',()=>{clips.splice(index,1);persist();drawClips();}));box.append(row);
    });
  }
  async function addClip() {
    if (!camera) return;
    if(!loaded)throw Error('Не удалось прочитать сохранённую очередь. Обнови страницу перед добавлением фрагментов.');
    const range = interval();
    if (clips.length>=50) throw Error('В одном запросе можно подготовить до 50 отдельных файлов.');
    clips.push({cameraId:camera.id,connectionId:camera.connectionId,cameraName:camera.displayName||camera.name,...range,name:get('name').value.trim() || (camera.displayName||camera.name)+' '+stamp(range.start)});
    persist();drawClips();feedback('Фрагмент добавлен. Можно выбрать следующий участок или другую камеру.');
  }
  async function ensureWorker(mode='video'){const health=await request('/health');if(!health.ok||health.version<2)throw Error('Сервис временно недоступен. Очередь сохранена в аккаунте.');if(mode==='video'&&health.exportReady===false)throw Error('Подготовка видео временно недоступна. Выбранные фрагменты сохранены в аккаунте.');}
  async function prepare() {
    await ensureWorker();
    if(!loaded)throw Error('Не удалось прочитать сохранённую очередь. Обнови страницу.');
    if (!clips.length) throw Error('Добавь хотя бы один фрагмент.');
    const owner = user;
    const payload = {clips:clips.map(c=>({...c})),quality:get('output').value,profile:get('profile').value,requestId:crypto.randomUUID()};
    feedback('Отправляем запись на подготовку…');
    const job = await request('/jobs',payload);
    if (owner!==user) return;
    jobs.unshift(job);persist();drawJobs();schedule();feedback('Задание принято. Файлы появятся во вкладке «Список архивов».');
  }
  function sharePlayer(url) {
    const href = new URL(url);
    const player = new URL('./archive-share.html',location.href);
    player.hash = encodeURIComponent(href.href);
    return player.href;
  }
  function sendToMessenger(url) {
    const messenger = new URL('../messages/',location.href);
    messenger.hash = 'archive=' + encodeURIComponent(sharePlayer(url));
    location.assign(messenger.href);
  }
  async function copyShare(url,statusElement=get('feedback')) {
    const player = sharePlayer(url);
    try {
      await navigator.clipboard.writeText(player);
      statusElement.textContent = 'Ссылка скопирована. Любой, у кого она есть, может открыть видео до истечения срока.';
    } catch {
      const field=document.createElement('input');
      field.readOnly=true; field.value=player; field.setAttribute('aria-label','Ссылка на видео');
      statusElement.replaceChildren(field); field.select();
    }
  }
  async function fileLink(job,file,name,share=false) {
    const result = await request('/jobs/'+encodeURIComponent(job.id)+'/file/'+encodeURIComponent(file.id),name===undefined?{share}:{name});
    return {name:result.name,url:WORKER+result.url};
  }
  async function saveFile(job,file,pick) {
    // The native picker must be opened during the click gesture.
    let handle;
    if (pick && window.showSaveFilePicker) handle = await window.showSaveFilePicker({suggestedName:file.name});
    const result = await fileLink(job,file);
    if (handle) {
      const response = await fetch(result.url);
      if (!response.ok || !response.body) throw Error('Не удалось скачать файл.');
      const writable = await handle.createWritable();
      await response.body.pipeTo(writable);
    } else if (pick && navigator.share && navigator.canShare && file.size<100*1024*1024) {
      const response = await fetch(result.url);
      if (!response.ok) throw Error('Не удалось скачать файл.');
      const blob = await response.blob();
      const shared = new File([blob],result.name,{type:file.mime||'video/mp4'});
      if (navigator.canShare({files:[shared]})) {
        const row=get('jobs').querySelector('[data-file="'+job.id+'-'+file.id+'"]');
        row.querySelector('.as-share-ready')?.remove();
        const ready=button('Сохранить через меню устройства',()=>navigator.share({files:[shared]}));
        ready.classList.add('as-share-ready');row.querySelector('.as-actions').append(ready);
        feedback('Файл готов. Нажми «Сохранить через меню устройства» и выбери «Сохранить в Файлы» или приложение диска.');
      } else download(result.url,result.name);
    } else {
      if (pick) feedback('Этот браузер выбирает папку через своё окно загрузки. На iPhone открой скачанный файл и выбери «Поделиться» → «Сохранить в Файлы».');
      download(result.url,result.name);
    }
  }
  function download(url,name) {
    const a=document.createElement('a');a.href=url;a.download=name;a.rel='noopener';document.body.append(a);a.click();a.remove();
  }
  async function rename(job,file) {
    const card=get('jobs').querySelector('[data-file="'+job.id+'-'+file.id+'"]');
    const input=card.querySelector('input');
    const result=await fileLink(job,file,input.value);
    file.name=result.name;input.value=result.name;feedback('Название файла сохранено.');
  }
  async function cloudSave(job,file,provider) {
    feedback('Сохраняем на диск…');
    const result = await request('/jobs/'+job.id+'/file/'+file.id+'/cloud/'+provider,{});
    feedback('Файл сохранён на '+(provider==='yandex'?'Яндекс Диске.':'Google Диске.'));
    if (provider==='yandex') {
      const notice = root.hidden ? records.querySelector('.as-records-feedback') : get('feedback');
      if (result.name) notice.append(' ' + result.name + ' ');
      notice.append(diskFolderLink());
    }
  }
  async function showFile(job,file,active=++generation) {
    const owner=user;
    const result=await fileLink(job,file);
    if(active!==generation || owner!==user) return;
    live.hidden=false;
    stop();stopPlayback();previewStart=file.sourceStart;previewBase=0;
    if(file.cameraId){camera={id:file.cameraId,connectionId:file.connectionId,name:file.cameraName||file.name};get('start').value=dateValue(file.sourceStart);get('end').value=dateValue(file.sourceStart+Math.floor(file.duration));syncTimeline();}
    liveName.textContent=file.name;
    previewLoading(true);
    status.textContent='Загружаем запись в плеер…';
    revealPlayer(live);
    previewTimer = setTimeout(()=>{
      previewLoading(false);
      status.textContent='Видео загружается дольше обычного.';
    },25000);
    video.crossOrigin='anonymous';video.src=result.url;video.load();video.play().catch(()=>{});
  }
  function diskFolderLink() {
    const link = document.createElement('a');
    link.className = 'secondary';
    link.textContent = 'Открыть папку на Яндекс Диске ↗';
    link.href = 'https://disk.yandex.ru/client/disk/' + ['Приложения','Эд ПВЗ — личный архив'].map(encodeURIComponent).join('/');
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  }
  function renderJobStatus(card,job) {
    const title = document.createElement('strong');
    title.textContent = job.title || 'Архив';
    const description = document.createElement('p');
    if (job.start && job.end) description.textContent = [job.cameraName, stamp(job.start) + ' — ' + stamp(job.end)].filter(Boolean).join(' · ');
    const stage = document.createElement('p');
    stage.textContent = (job.part ? 'Часть ' + job.part.index + ' из ' + job.part.total + ' · ' : '') + (job.message || 'Проверяем задание…');
    card.append(title);
    if(description.textContent) card.append(description);
    card.append(stage);
    if (job.cloudFiles?.length || (job.state === 'ready' && job.message?.includes('на твоём Яндекс Диске'))) {
      for (const name of job.cloudFiles || []) {
        const file = document.createElement('p');
        file.textContent = name;
        card.append(file);
      }
      card.append(diskFolderLink());
    }
    if (['queued','processing','uploading'].includes(job.state)) {
      const progress = document.createElement('progress');
      progress.max = 100;
      if (job.progress > 0) progress.value = job.progress;
      progress.setAttribute('aria-label','Общий прогресс подготовки');
      card.append(progress);
      if (job.progress > 0) {
        const percentage = document.createElement('small');
        percentage.textContent = 'Общий прогресс: ' + job.progress + '%';
        card.append(percentage);
      }
    }
  }
  function drawJobs() {
    const box=records.querySelector('.as-jobs');box.replaceChildren();
    records.querySelector('.as-empty').hidden = Boolean(jobs.length || originalFiles.children.length);
    const current = get('current');
    const tracked = jobs.find(job=>job.destination === 'yandex' && ['queued','processing','uploading'].includes(job.state))
      || jobs.find(job=>job.destination === 'yandex');
    current.replaceChildren();
    current.hidden = !tracked;
    if (tracked) renderJobStatus(current,tracked);
    for(const job of jobs) {
      const card=document.createElement('article');card.className='as-card';
      renderJobStatus(card,job);
      if(['processing','queued'].includes(job.state))card.append(button('Отменить',async()=>{Object.assign(job,await request('/jobs/'+job.id+'/cancel',{}));finishPreview(job);drawJobs();}));
      if(job.state==='failed'||job.state==='cancelled'||job.state==='expired')card.append(button('Убрать из списка',()=>{jobs=jobs.filter(x=>x!==job);persist();drawJobs();}));
      for(const file of job.files||[]) {
        const row=document.createElement('section');row.className='as-file';row.dataset.file=job.id+'-'+file.id;
        const name=document.createElement('input');name.value=file.name;name.maxLength=110;name.setAttribute('aria-label','Имя готового файла');
        const info=document.createElement('p');info.textContent=(file.size/1024/1024).toFixed(1)+' МБ · '+file.width+'×'+file.height+(file.duration?' · '+duration(file.duration):'');
        const actions=document.createElement('div');actions.className='as-actions';
        const primary = document.createElement('div');primary.className='as-actions';
        primary.append(button('Скачать',()=>saveFile(job,file,false)));
        const more = document.createElement('details');
        const summary = document.createElement('summary');summary.textContent='Другие действия';
        actions.append(button('Переименовать',()=>rename(job,file)),button('Выбрать место сохранения',()=>saveFile(job,file,true)));
        if(!file.mime) actions.append(button('Скопировать ссылку',async()=>copyShare((await fileLink(job,file,undefined,true)).url)),button('В Эдсенджер',async()=>sendToMessenger((await fileLink(job,file,undefined,true)).url)),button('Кадр из файла',async()=>{
          if(!video.videoWidth||liveName.textContent!==file.name)throw Error('Сначала нажми «Посмотреть» и выбери кадр.');
          await request('/jobs/'+job.id+'/file/'+file.id+'/frame',{second:Math.min(video.currentTime,Math.max(0,file.duration-1/(file.fps||25)))});
          Object.assign(job,await request('/jobs/'+job.id));drawJobs();
        }));
        if(config?.yandex?.connected)actions.append(button('На Яндекс Диск',()=>cloudSave(job,file,'yandex')));
        if(config?.google?.connected)actions.append(button('На Google Диск',()=>cloudSave(job,file,'google')));
        if (!file.mime) primary.append(button('Посмотреть',()=>showFile(job,file)));
        const fileTitle = document.createElement('strong');
        fileTitle.textContent = file.name;
        more.append(summary,name,actions);
        row.append(fileTitle,info,primary,more);card.append(row);
      }
      box.append(card);
    }

  }
  function finishPreview(job) {
    if (job.previewGeneration !== generation) return;
    delete job.previewGeneration;
    previewLoading(false);
    status.textContent=job.message || 'Не удалось открыть запись.';
  }
  function schedule() {
    clearTimeout(poll);
    const complete = ['ready','failed','cancelled','expired'];
    if(!user||!jobs.some(j=>!complete.includes(j.state)))return;
    poll=setTimeout(async()=>{
      const owner=user;
      for(const job of jobs.filter(j=>!complete.includes(j.state))) {
        try {
          const result=await request('/jobs/'+job.id);
          if(owner!==user)return;
          Object.assign(job,result);
          if (job.state === 'ready' && job.destination === 'yandex') persist();
          if(job.previewGeneration !== generation) continue;
          if(job.state==='ready'&&job.files?.[0]) {
            const active=job.previewGeneration;
            await showFile(job,job.files[0],active);
            delete job.previewGeneration;
          } else if(complete.includes(job.state)) finishPreview(job);
          else status.textContent=job.message || 'Подготавливаем видео для просмотра…';
        } catch(error) {
          if(error.status===404) Object.assign(job,{state:'expired',message:error.message});
          if(complete.includes(job.state)) finishPreview(job);
          feedback(error.message);
        }
      }
      drawJobs();schedule();
    },4000);
  }
  get('save-yandex').addEventListener('click', async()=>{
    const control=get('save-yandex');
    setLoading(control,true);
    try {
      if (!camera || !loaded) throw Error('Выбери камеру и дождись загрузки архива.');
      const range=interval(), owner=user, cameraName=camera.displayName||camera.name;
      const job=await request('/jobs',{
        clips:[{cameraId:camera.id,connectionId:camera.connectionId,cameraName,...range,name:get('name').value.trim()||cameraName+' '+stamp(range.start)}],
        quality:get('output').value,profile:get('profile').value,requestId:crypto.randomUUID(),saveToYandex:true
      });
      if(owner!==user)return;
      job.destination='yandex';
      job.title=job.title || cameraName;
      jobs.unshift(job);persist();drawJobs();schedule();
      feedback('');
    } catch(error){feedback(error.message);}
    finally{setLoading(control,false);}
  });
  async function clouds() {
    const user = account()?.user?.id;
    if (!user) return;
    const status = await request('/cloud').catch(() => null);
    if (account()?.user?.id !== user) return;
    config = status;
    get('save-yandex').hidden = !(config?.yandex?.configured && config.yandex.connected);
    drawJobs();
  }
  async function capture() {
    await ensureWorker('frame');
    if(!video.videoWidth)throw Error('Сначала открой видео и выбери кадр.');
    const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
    try {
      canvas.getContext('2d').drawImage(video,0,0);
      const jpeg=canvas.toDataURL('image/jpeg',.95).split(',')[1];
      const job=await request('/jobs/frame',{jpeg,name:'Кадр '+new Date().toISOString().replace(/[:.]/g,'-')});
      jobs.unshift(job);persist();drawJobs();feedback('Кадр готов. Переименуй и выбери способ сохранения в списке файлов.');
    } catch(error) {
      if(error.name==='SecurityError')throw Error('Камера ограничивает сохранение кадра в браузере. Подготовь MP4, открой его и нажми «Кадр из файла».');
      throw error;
    }
  }
  async function sync() {
    const id=account()?.user?.id;if(id===user)return;
    generation++;stop();previewLoading(false);clearTimeout(poll);clearTimeout(saving);user=id;originalFiles.replaceChildren();originalStatus.textContent='';records.querySelector('.as-records-feedback').textContent='';clips=[];jobs=[];config=undefined;loaded=false;camera=undefined;root.hidden=true;drawJobs();drawClips();
    if(!id)return;
    try{const saved=await account().load('ivideon-archive-project');if(user!==id)return;clips=Array.isArray(saved?.payload?.clips)?saved.payload.clips.slice(0,50):[];jobs=Array.isArray(saved?.payload?.jobs)?saved.payload.jobs.slice(0,50):[];loaded=true;drawClips();drawJobs();schedule();void clouds();}catch(error){feedback(error.message);}
  }
  window.addEventListener('pageshow', clouds);
  get('preview').addEventListener('click',()=>{
    const operation=preview(), active=generation;
    operation.catch(error=>{
      if (active!==generation) return;
      previewLoading(false);
      status.textContent=error.message;
    });
  });
  get('mark-start').addEventListener('click',()=>{try{mark('start');}catch(e){feedback(e.message);}});
  get('mark-end').addEventListener('click',()=>{try{mark('end');}catch(e){feedback(e.message);}});
  get('add').addEventListener('click',()=>addClip().catch(e=>feedback(e.message)));
  get('build').addEventListener('click',async()=>{setLoading(get('build'),true);try{await prepare();}catch(e){feedback(e.message);}finally{setLoading(get('build'),false);}});
  get('frame').addEventListener('click',()=>capture().catch(e=>feedback(e.message)));
  window.addEventListener('edpvz-auth-changed',sync);
  window.addEventListener('pagehide',()=>{clearTimeout(poll);stop();for(const url of urls)URL.revokeObjectURL(url);});
  void sync();
  return {
    open(nextCamera){root.insertBefore(video,get('head').nextSibling);camera=nextCamera;for (const action of ['build','preview']) get(action).disabled=true;
      const checkCamera=camera;
      const setAvailability=(available)=>{
        if (camera!==checkCamera) return;
        get('service-state').hidden=available;
        get('service-state').textContent='Подготовка видео в Эд ПВЗ временно недоступна. Можно сохранить интервалы в очереди или скачать готовый экспорт в Ivideon.';
        for (const action of ['build','preview']) get(action).disabled=!available;
      };
      const availability = request('/health').then(health=>setAvailability(health.ok && health.version>=2 && health.exportReady===true)).catch(()=>setAvailability(false));
      root.hidden=false;live.hidden=false;previewStart=undefined;liveName.textContent=camera.displayName||camera.name;const now=Math.floor(Date.now()/1000);get('start').value=dateValue(now-600);get('end').value=dateValue(now-300);get('name').value='';syncTimeline();drawClips();drawJobs();return availability;},
    reset(){generation++;stop();previewLoading(false);video.pause();video.removeAttribute('src');video.load();live.appendChild(video);camera=undefined;previewStart=undefined;root.hidden=true;},
  };
}

