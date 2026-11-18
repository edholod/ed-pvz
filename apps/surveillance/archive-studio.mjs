const WORKER = 'https://edpvz-telegram-collector.onrender.com';
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
  const {video, live, liveName, status, playHls, stopPlayback} = options;
  const root = document.createElement('section');
  root.className = 'archive-studio';
  root.hidden = true;
  root.innerHTML = `
    <header class="as-head"><h2>Архив</h2><span class="as-zone"></span></header>
    <div class="as-inputs">
      <label>Начало<input class="as-start" type="datetime-local" step="1"></label>
      <label>Конец<input class="as-end" type="datetime-local" step="1"></label>
      <label>Качество просмотра<select class="as-profile"><option value="auto">Автоматически</option><option value="high">Основной поток</option><option value="low">Дополнительный поток</option></select></label>
    </div>
    <details class="as-day"><summary>Выбрать на шкале дня</summary>
      <label>День<input class="as-date" type="date"></label>
      <label>Начало на шкале <output class="as-from-text"></output><input class="as-from" type="range" min="0" max="86399" step="1" value="32400"></label>
      <label>Конец на шкале <output class="as-to-text"></output><input class="as-to" type="range" min="1" max="86400" step="1" value="32700"></label>
    </details>
    <p class="as-note">Шкала задаёт время запроса. Наличие записи зависит от архива камеры. Большой интервал можно добавить в очередь целиком.</p>
    <div class="as-actions"><button class="primary as-preview">Просмотреть</button><button class="secondary as-mark-start">Начало по текущему кадру</button><button class="secondary as-mark-end">Конец по текущему кадру</button><button class="secondary as-frame">Сохранить кадр</button></div>
    <div class="as-inputs"><label>Название фрагмента<input class="as-name" maxlength="100" placeholder="Например, Отказ клиента"></label><label>Качество файла<select class="as-output"><option value="source">Разрешение выбранного потока</option><option value="1080">До 1080p</option><option value="720">До 720p</option><option value="480">До 480p</option></select></label></div>
    <div class="as-actions"><button class="primary as-add">Добавить фрагмент</button></div>
    <p class="as-feedback" role="status"></p>
    <h3>Фрагменты к подготовке</h3><div class="as-clips"></div>
    <div class="as-actions"><button class="primary as-build">Подготовить файлы</button></div>
    <p class="as-note">Длинная запись обрабатывается частями и склеивается на сервере. При пробеле или несовпадении длительности появится ошибка. Пониженное разрешение не увеличивает детализацию исходной записи.</p>
    <h3>Готовые файлы и задания</h3><div class="as-jobs"></div>
    <p class="as-note">Готовые файлы временно хранятся до 24 часов. Перезапуск сервера может удалить временные файлы — в этом случае подготовь их заново.</p>
    <details><summary>Яндекс Диск и Google Диск</summary><div class="as-cloud"></div><p class="as-cloud-status" role="status"></p></details>`;
  live.insertBefore(root, video);
  const get = name => $(root, '.as-' + name);
  get('zone').textContent = 'Время устройства · ' + Intl.DateTimeFormat().resolvedOptions().timeZone;
  const account = () => window.EdPVZAccount;
  let camera, playback, previewStart, previewBase = 0, user, generation = 0, poll, saving;
  let clips = [], jobs = [], loaded = false, config;
  const urls = new Set();
  const feedback = text => { get('feedback').textContent = text; };
  const request = (path, body) => account().archiveRequest(path, body);
  function button(text, fn) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'secondary'; b.textContent = text;
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { await fn(); } catch (error) { feedback(error.message || 'Операция не выполнена.'); }
      finally { b.disabled = false; }
    });
    return b;
  }
  function persist() {
    clearTimeout(saving);
    const owner = user;
    saving = setTimeout(() => {
      if (owner !== user || account()?.user?.id !== owner) return;
      account().save('ivideon-archive-project', {clips, jobs: jobs.map(j => ({id:j.id, title:j.title || 'Архив'}))}).catch(() => feedback('Не удалось сохранить очередь в аккаунте.'));
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
    get('from-text').textContent = duration(from); get('to-text').textContent = duration(Math.max(from+1,to));
  }
  function applyTimeline() {
    const day = new Date(get('date').value+'T00:00:00');
    const from = Number(get('from').value), to = Math.max(from+1, Number(get('to').value));
    get('to').value = to;
    get('start').value = dateValue(day.getTime()/1000 + from);
    get('end').value = dateValue(day.getTime()/1000 + to);
    get('from-text').textContent = duration(from); get('to-text').textContent = duration(to);
  }
  for (const field of ['from','to','date']) get(field).addEventListener('input',applyTimeline);
  for (const field of ['start','end']) get(field).addEventListener('change',syncTimeline);
  function stop() {
    playback?.(); playback = undefined;
  }
  async function preview() {
    if (!camera) return;
    const {start,end} = interval();
    if (end-start > 3600) throw Error('Для просмотра выбери участок до часа. В очередь подготовки можно добавить весь интервал.');
    const active = ++generation;
    stop(); stopPlayback();
    status.textContent = 'Загружаем запись…';
    const result = await account().checkIvideon(undefined,camera.id,undefined,'load',{start,end,profile:get('profile').value});
    if (active !== generation) return;
    previewStart = start; previewBase = 0;
    liveName.textContent = camera.displayName || camera.name;
    playback = playHls(video,result.streamUrl,(message) => {
      if (active === generation) status.textContent = message || ('Архив · '+stamp(start));
    });
  }
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
    const range = interval();
    if (clips.length>=50) throw Error('В одном запросе можно подготовить до 50 отдельных файлов.');
    clips.push({cameraId:camera.id,cameraName:camera.displayName||camera.name,...range,name:get('name').value.trim() || (camera.displayName||camera.name)+' '+stamp(range.start)});
    persist();drawClips();feedback('Фрагмент добавлен. Можно выбрать следующий участок или другую камеру.');
  }
  async function prepare() {
    if (!clips.length) throw Error('Добавь хотя бы один фрагмент.');
    const owner = user;
    const payload = {clips:clips.map(c=>({...c})),quality:get('output').value,profile:get('profile').value,requestId:crypto.randomUUID()};
    feedback('Отправляем запись на подготовку…');
    const job = await request('/jobs',payload);
    if (owner!==user) return;
    jobs.unshift(job);persist();drawJobs();schedule();feedback('Задание принято. Файлы появятся ниже по мере готовности.');
  }
  async function fileLink(job,file,name) {
    const result = await request('/jobs/'+encodeURIComponent(job.id)+'/file/'+encodeURIComponent(file.id),name===undefined?{}:{name});
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
    } else if (pick && navigator.share && navigator.canShare) {
      const response = await fetch(result.url);
      if (!response.ok) throw Error('Не удалось скачать файл.');
      const blob = await response.blob();
      const shared = new File([blob],result.name,{type:file.mime||'video/mp4'});
      if (navigator.canShare({files:[shared]})) await navigator.share({files:[shared]});
      else download(result.url,result.name);
    } else {
      if (pick) feedback('Этот браузер выбирает папку через своё окно загрузки. На iPhone используй «Поделиться» → «Сохранить в Файлы».');
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
    await request('/jobs/'+job.id+'/file/'+file.id+'/cloud/'+provider,{});
    feedback('Файл сохранён на '+(provider==='yandex'?'Яндекс Диске.':'Google Диске.'));
  }
  async function showFile(job,file) {
    const result=await fileLink(job,file);
    stop();stopPlayback();previewStart=file.sourceStart;previewBase=0;
    if(file.cameraId){camera={id:file.cameraId,name:file.name};get('start').value=dateValue(file.sourceStart);get('end').value=dateValue(file.sourceStart+Math.floor(file.duration));syncTimeline();}
    video.src=result.url;video.load();video.play().catch(()=>{});
    liveName.textContent=file.name;
    status.textContent='Готовый файл. Можно отметить начало и конец следующего фрагмента.';
  }
  function drawJobs() {
    const box=get('jobs');box.replaceChildren();
    for(const job of jobs) {
      const card=document.createElement('article');card.className='as-card';
      const title=document.createElement('strong');title.textContent=job.message||'Проверяем задание…';
      const progress=document.createElement('progress');progress.max=100;progress.value=job.progress||0;
      card.append(title,progress);
      if(['processing','queued'].includes(job.state))card.append(button('Отменить',async()=>{Object.assign(job,await request('/jobs/'+job.id+'/cancel',{}));drawJobs();}));
      if(job.state==='failed'||job.state==='cancelled'||job.state==='expired')card.append(button('Убрать из списка',()=>{jobs=jobs.filter(x=>x!==job);persist();drawJobs();}));
      for(const file of job.files||[]) {
        const row=document.createElement('section');row.className='as-file';row.dataset.file=job.id+'-'+file.id;
        const name=document.createElement('input');name.value=file.name;name.maxLength=110;name.setAttribute('aria-label','Имя готового файла');
        const info=document.createElement('p');info.textContent=(file.size/1024/1024).toFixed(1)+' МБ · '+file.width+'×'+file.height+(file.duration?' · '+duration(file.duration):'');
        const actions=document.createElement('div');actions.className='as-actions';
        actions.append(button('Переименовать',()=>rename(job,file)),button('Скачать в загрузки',()=>saveFile(job,file,false)),button('Выбрать место сохранения',()=>saveFile(job,file,true)));
        if(!file.mime) actions.append(button('Посмотреть',()=>showFile(job,file)),button('Кадр из файла',async()=>{
          if(!video.videoWidth||liveName.textContent!==file.name)throw Error('Сначала нажми «Посмотреть» и выбери кадр.');
          await request('/jobs/'+job.id+'/file/'+file.id+'/frame',{second:video.currentTime});
          Object.assign(job,await request('/jobs/'+job.id));drawJobs();
        }));
        if(config?.yandex?.connected)actions.append(button('На Яндекс Диск',()=>cloudSave(job,file,'yandex')));
        if(config?.google?.connected)actions.append(button('На Google Диск',()=>cloudSave(job,file,'google')));
        row.append(name,info,actions);card.append(row);
      }
      box.append(card);
    }
    if(!jobs.length)box.textContent='Здесь появятся подготовленные файлы.';
  }
  function schedule() {
    clearTimeout(poll);
    if(!user||!jobs.some(j=>!['ready','failed','cancelled','expired'].includes(j.state)))return;
    poll=setTimeout(async()=>{
      const owner=user;
      for(const job of jobs.filter(j=>!['ready','failed','cancelled','expired'].includes(j.state))) {
        try { const result=await request('/jobs/'+job.id);if(owner!==user)return;Object.assign(job,result); }
        catch(error){if(error.status===404)Object.assign(job,{state:'expired',message:error.message});else feedback(error.message);}
      }
      drawJobs();schedule();
    },4000);
  }
  async function clouds() {
    try {
      config=await request('/cloud');
      const box=get('cloud');box.replaceChildren();
      for(const provider of ['yandex','google']) {
        const cloud=config[provider];const name=provider==='yandex'?'Яндекс Диск':'Google Диск';
        if(!cloud.configured){const note=document.createElement('p');note.textContent=name+': подключение OAuth-приложения ещё не настроено.';box.append(note);continue;}
        box.append(button(cloud.connected?'Отключить '+name:'Подключить '+name,async()=>{
          if(cloud.connected){await request('/cloud/'+provider+'/disconnect',{});await clouds();drawJobs();}
          else {const tab=window.open('about:blank','_blank');try{const result=await request('/cloud/'+provider+'/connect',{});if(tab)tab.location.href=result.url;else window.location.href=result.url;}catch(e){tab?.close();throw e;}}
        }));
      }
      drawJobs();
    } catch(error){get('cloud-status').textContent=error.message;}
  }
  async function capture() {
    if(!video.videoWidth)throw Error('Сначала открой видео и выбери кадр.');
    const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
    try {canvas.getContext('2d').drawImage(video,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.95));if(!blob)throw Error();const url=URL.createObjectURL(blob);urls.add(url);const name='Кадр '+new Date().toISOString().replace(/[:.]/g,'-')+'.jpg';download(url,name);if(navigator.canShare?.({files:[new File([blob],name,{type:'image/jpeg'})]}))feedback('Кадр скачан. Для сохранения на диск используй меню «Поделиться» готового файла.');}
    catch{throw Error('Камера ограничивает сохранение кадра в браузере. Подготовь MP4, открой его и нажми «Кадр из файла» — кадр будет доступен для сохранения на диск.');}
  }
  async function sync() {
    const id=account()?.user?.id;if(id===user)return;
    generation++;stop();clearTimeout(poll);clearTimeout(saving);user=id;clips=[];jobs=[];config=undefined;loaded=false;camera=undefined;root.hidden=true;drawJobs();drawClips();
    if(!id)return;
    try{const saved=await account().load('ivideon-archive-project');if(user!==id)return;clips=Array.isArray(saved?.payload?.clips)?saved.payload.clips.slice(0,50):[];jobs=Array.isArray(saved?.payload?.jobs)?saved.payload.jobs.slice(0,50):[];loaded=true;drawClips();drawJobs();schedule();void clouds();}catch(error){feedback(error.message);}
  }
  get('preview').addEventListener('click',()=>preview().catch(e=>feedback(e.message)));
  get('mark-start').addEventListener('click',()=>{try{mark('start');}catch(e){feedback(e.message);}});
  get('mark-end').addEventListener('click',()=>{try{mark('end');}catch(e){feedback(e.message);}});
  get('add').addEventListener('click',()=>addClip().catch(e=>feedback(e.message)));
  get('build').addEventListener('click',async()=>{get('build').disabled=true;try{await prepare();}catch(e){feedback(e.message);}finally{get('build').disabled=false;}});
  get('frame').addEventListener('click',()=>capture().catch(e=>feedback(e.message)));
  window.addEventListener('edpvz-auth-changed',sync);
  window.addEventListener('pagehide',()=>{clearTimeout(poll);stop();for(const url of urls)URL.revokeObjectURL(url);});
  void sync();
  return {
    open(nextCamera){camera=nextCamera;root.hidden=false;live.hidden=false;previewStart=undefined;liveName.textContent=camera.displayName||camera.name;const now=Math.floor(Date.now()/1000);get('start').value=dateValue(now-600);get('end').value=dateValue(now-300);get('name').value='';syncTimeline();drawClips();drawJobs();},
    reset(){generation++;stop();camera=undefined;previewStart=undefined;root.hidden=true;},
  };
}
