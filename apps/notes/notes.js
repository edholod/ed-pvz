(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const api = 'https://duerixyhzapotoeclggz.supabase.co/rest/v1/edpvz_personal_notes';
  const key = 'sb_publishable_fKE2S2rAz7VMa54rgO4uvQ_vyzFPwmV';
  const fields = 'id,title,body,updated_at';
  let userId = null, epoch = 0, notes = [], selected = null, busy = false;

  async function request(session, params, method = 'GET', body) {
    const attempts = method === 'GET' ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(api + '?' + new URLSearchParams(params), {
          method, cache: 'no-store', signal: controller.signal,
          headers: {
            apikey: key, Authorization: 'Bearer ' + session.access_token,
            'Content-Type': 'application/json', Prefer: 'return=representation'
          },
          body: body === undefined ? undefined : JSON.stringify(body)
        });
        if (!response.ok) {
          if (method === 'GET' && [429,502,503,504].includes(response.status) && attempt + 1 < attempts) {
            await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
            continue;
          }
          throw Error('Не удалось ' + (method === 'GET' ? 'загрузить' : 'изменить') + ' заметки (HTTP ' + response.status + '). Попробуй ещё раз.');
        }
        return response.json();
      } catch (error) {
        if (method !== 'GET' || attempt + 1 === attempts || !(!error.status && (error.name === 'AbortError' || error instanceof TypeError))) {
          if (error.name === 'AbortError') throw Error('Сервер долго не отвечает. Попробуй ещё раз.');
          if (error.message === 'Load failed' || error instanceof TypeError) throw Error('Нет соединения с сервером. Попробуй ещё раз.');
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
      } finally {
        clearTimeout(timer);
      }
    }
  }

  const displayTitle = note => note.title || note.body.trim().split('\n')[0].slice(0, 100) || 'Без названия';
  const draft = () => ({title: $('title').value.trim(), body: $('body').value.trim()});
  function mayClose() {
    if (busy) return false;
    if ($('editor').hidden) return true;
    const value = draft();
    return (value.title === (selected?.title || '') && value.body === (selected?.body || '')) ||
      confirm('Закрыть заметку без сохранения изменений?');
  }

  function render() {
    const query = $('search').value.trim().toLocaleLowerCase('ru');
    const visible = notes.filter(note => (note.title + '\n' + note.body).toLocaleLowerCase('ru').includes(query));
    $('notes').replaceChildren();
    $('empty').hidden = !!visible.length;
    $('empty').textContent = query ? 'По этому запросу ничего не найдено.' : 'Здесь появятся твои заметки.';
    for (const note of visible) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'note';
      if (note.id === selected?.id) button.setAttribute('aria-current', 'true');
      const heading = document.createElement('strong');
      heading.textContent = displayTitle(note);
      const preview = document.createElement('span');
      preview.textContent = note.body.slice(0, 200);
      preview.hidden = !note.body;
      const time = document.createElement('time');
      time.dateTime = note.updated_at;
      time.textContent = new Date(note.updated_at).toLocaleString('ru-RU', {dateStyle:'short', timeStyle:'short'});
      button.append(heading, preview, time);
      button.onclick = () => {
        if (note.id !== selected?.id && mayClose()) open(note);
      };
      $('notes').append(button);
    }
  }

  function open(note) {
    selected = note;
    $('title').value = note?.title || '';
    $('body').value = note?.body || '';
    $('delete').hidden = !note;
    $('editor-status').textContent = '';
    $('export-status').textContent = '';
    $('editor').hidden = false;
    showPreview(false);
    render();
    $(note ? 'rich' : 'title').focus();
  }

  function close() {
    clearTimeout(timer); selected = null;
    if ($('insert-table').open) $('insert-table').close();
    showPreview(false);
    $('editor').hidden = true;
    $('title').value = '';
    $('body').value = '';
    $('editor-status').textContent = '';
    $('export-status').textContent = '';
    render();
  }

  function setBusy(value) {
    busy = value; $('rich').contentEditable=String(!value);
    for (const id of ['save','delete','cancel','new-note','title','body']) $(id).disabled = value;
    for (const control of $('editor').querySelectorAll('[data-format],#preview input')) control.disabled = value;
  }

  async function load() {
    const run = ++epoch;
    userId = null;
    const hadNotes = notes.length > 0;
    if (!hadNotes) close();
    setBusy(false);
    for (const id of ['login','retry']) $(id).hidden = true;
    if (!hadNotes) { $('workspace').hidden = true; $('new-note').hidden = true; }
    $('status').textContent = 'Загружаем заметки…';
    try {
      const session = await window.EdPVZAccount.ensure();
      if (run !== epoch) return;
      if (!session?.access_token || !session.user?.id) {
        $('status').textContent = 'Войди в аккаунт, чтобы открыть личные заметки.';
        $('login').hidden = false;
        return;
      }
      userId = session.user.id;
      const collected = [];
      for (let offset = 0; ; offset += 100) {
        const batch = await request(session, {
          select: fields, user_id: 'eq.' + userId, order: 'updated_at.desc,id.asc', limit: '100', offset
        });
        if (run !== epoch) return;
        collected.push(...batch);
        if (batch.length < 100) break;
      }
      notes = collected;
      render();
      $('status').textContent = '';
      $('workspace').hidden = $('new-note').hidden = false;
    } catch (error) {
      if (run !== epoch) return;
      $('status').textContent = hadNotes ? 'Не удалось обновить заметки: ' + error.message : error.message;
      $('retry').hidden = false;
    }
  }

  async function change(method, value) {
    const run = epoch;
    const original = selected;
    setBusy(true);
    $('editor-status').textContent = method === 'DELETE' ? 'Удаляем…' : 'Сохраняем…';
    try {
      const session = await window.EdPVZAccount.ensure();
      if (run !== epoch) return;
      if (!session?.access_token || session.user?.id !== userId) throw Error('Сессия завершилась. Войди в аккаунт снова.');
      const params = {select:fields};
      if (original) {
        params.id = 'eq.' + original.id;
        params.user_id = 'eq.' + userId;
        params.updated_at = 'eq.' + original.updated_at;
      }
      const rows = await request(session, params, method, value);
      if (run !== epoch) return;
      if (!rows.length) throw Error('Заметка изменилась на другом устройстве. Скопируй свои правки и обнови страницу.');
      notes = notes.filter(note => note.id !== rows[0].id);
      if (method === 'DELETE') {
        close();
        $('status').textContent = 'Заметка удалена.';
      } else {
        selected = rows[0];
        notes.unshift(selected);
        $('title').value = selected.title;
        $('body').value = selected.body;
        $('delete').hidden = false;
        
        $('editor-status').textContent = 'Сохранено.';
        $('status').textContent = '';
        render();
      }
    } catch (error) {
      if (run === epoch) $('editor-status').textContent = error.message;
    } finally {
      if (run === epoch) setBusy(false);
    }
  }

  const bodyInput=$('body'), rich=$('rich'), tableDialog=$('insert-table');
  let previewing=false, timer, range;
  function inline(n){if(n.nodeType===3)return n.textContent;const t=n.tagName;if(t==='INPUT')return '';if(t==='BR')return '\n';const s=Array.from(n.childNodes,inline).join('');if(['B','STRONG'].includes(t))return '**'+s+'**';if(['I','EM'].includes(t))return '*'+s+'*';if(['S','STRIKE','DEL'].includes(t))return '~~'+s+'~~';if(t==='CODE')return '`'+s+'`';if(t==='A'){const u=window.EdPVZNoteFormat.safeLink(n.getAttribute('href'));return u?'['+s+']('+u.replace(/\(/g,'%28').replace(/\)/g,'%29')+')':s}return s}
  function serialize(){return Array.from(rich.childNodes,n=>{if(n.nodeType===3)return n.textContent;const t=n.tagName;if(t==='UL'||t==='OL')return Array.from(n.children,(li,i)=>{const check=li.querySelector('input[type=checkbox]');return (check?(check.checked?'- [x] ':'- [ ] '):t==='OL'?(i+1)+'. ':'- ')+inline(li)}).join('\n');if(n.querySelector('table')||t==='TABLE'){const rows=Array.from(n.querySelectorAll('tr'),r=>Array.from(r.cells,c=>inline(c).replace(/\|/g,'¦').replace(/\n/g,' ')));if(!rows.length)return '';const line=a=>'| '+a.join(' | ')+' |';return [line(rows[0]),line(rows[0].map(()=> '---')),...rows.slice(1).map(line)].join('\n')}if(t==='HR')return '---';if(t==='PRE')return '```\n'+n.textContent+'\n```';if(/^H[1-4]$/.test(t))return '## '+inline(n);if(t==='BLOCKQUOTE')return inline(n).split('\n').map(x=>'> '+x).join('\n');return inline(n)}).join('\n').trim()}
  function sync(){bodyInput.value=serialize();clearTimeout(timer);$('editor-status').textContent='Изменено…';timer=setTimeout(()=>{if(!busy&&!$('editor').hidden&&bodyInput.value.length<=20000){const v=draft();if((v.title||v.body)&&(v.title!==(selected?.title||'')||v.body!==(selected?.body||'')))change(selected?'PATCH':'POST',v)}},1800)}
  function showPreview(){clearTimeout(timer);range=null;window.EdPVZNoteFormat.render(bodyInput.value,rich,()=>sync());for(const x of rich.querySelectorAll('input[type=checkbox]')){x.contentEditable='false';x.onchange=sync}if(!rich.childNodes.length)rich.append(document.createElement('p'))}
  function remember(){const s=getSelection();if(s.rangeCount&&rich.contains(s.anchorNode))range=s.getRangeAt(0).cloneRange()}
  document.addEventListener('selectionchange',remember);
  function restore(){rich.focus();if(range&&rich.contains(range.commonAncestorContainer)){const s=getSelection();s.removeAllRanges();s.addRange(range)}}
  function insert(html){restore();document.execCommand('insertHTML',false,html);sync()}
  rich.addEventListener('input',sync);$('title').addEventListener('input',sync);
  rich.addEventListener('paste',e=>{e.preventDefault();document.execCommand('insertText',false,e.clipboardData.getData('text/plain'));sync()});
  $('tools').addEventListener('pointerdown',e=>{if(e.target.closest('button')){remember();e.preventDefault()}});
  $('tools').addEventListener('click',e=>{const b=e.target.closest('[data-format]');if(!b||busy)return;const a=b.dataset.format;restore();const commands={bold:'bold',italic:'italic',strike:'strikeThrough',bullets:'insertUnorderedList',numbered:'insertOrderedList',undo:'undo',redo:'redo'};if(commands[a])document.execCommand(commands[a]);else if(a==='heading'||a==='quote'||a==='code')document.execCommand('formatBlock',false,({heading:'h2',quote:'blockquote',code:'pre'})[a]);else if(a==='divider')document.execCommand('insertHorizontalRule');else if(a==='checklist'){insert('<ul class="checks"><li><label><input type="checkbox" contenteditable="false"> Новая задача</label></li></ul><p><br></p>');return}else if(a==='table'){remember();tableDialog.returnValue='';tableDialog.showModal();return}else if(a==='link'){const u=window.EdPVZNoteFormat.safeLink(prompt('Адрес ссылки','https://')||'');if(u){restore();document.execCommand('createLink',false,u)}}sync()});
  rich.addEventListener('change',e=>{if(e.target.type==='checkbox')sync()});
  $('cancel-table').onclick=()=>tableDialog.close();
  tableDialog.addEventListener('close',()=>{if(tableDialog.returnValue!=='insert'||busy)return;const cols=Number($('table-cols').value),rows=Number($('table-rows').value);if(!Number.isInteger(cols)||cols<1||cols>10||!Number.isInteger(rows)||rows<1||rows>30)return;insert('<div class="note-table"><table><thead><tr>'+Array.from({length:cols},(_,i)=>'<th>Столбец '+(i+1)+'</th>').join('')+'</tr></thead><tbody>'+('<tr>'+'<td><br></td>'.repeat(cols)+'</tr>').repeat(rows)+'</tbody></table></div><p><br></p>')});
  $('editor').addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();$('editor').requestSubmit()}});
  $('search').addEventListener('input', render);
  $('new-note').onclick = () => { if (mayClose()) open(null); };
  $('cancel').onclick = () => { if (mayClose()) close(); };
  $('retry').onclick = load;
  $('delete').onclick = () => {
    if (!busy && selected && confirm('Удалить эту заметку?')) change('DELETE');
  };
  $('editor').onsubmit = event => {
    event.preventDefault();
    if (busy) return;
    const value = draft();
    if(value.body.length>20000){$('editor-status').textContent='Лимит заметки — 20 000 символов.';return;} if (!value.title && !value.body) {
      $('editor-status').textContent = 'Напиши заголовок или текст заметки.';
      return;
    }
    change(selected ? 'PATCH' : 'POST', value);
  };
  window.addEventListener('edpvz-auth-changed', event => {
    if ((event.detail?.user?.id || null) !== userId || !event.detail?.user) load();
  });
  load();
})();
