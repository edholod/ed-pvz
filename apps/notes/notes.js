(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const api = 'https://duerixyhzapotoeclggz.supabase.co/rest/v1/edpvz_personal_notes';
  const key = 'sb_publishable_fKE2S2rAz7VMa54rgO4uvQ_vyzFPwmV';
  const fields = 'id,title,body,updated_at';
  let userId = null, epoch = 0, notes = [], selected = null, busy = false;

  async function request(session, params, method = 'GET', body) {
    const response = await fetch(api + '?' + new URLSearchParams(params), {
      method, cache: 'no-store',
      headers: {
        apikey: key, Authorization: 'Bearer ' + session.access_token,
        'Content-Type': 'application/json', Prefer: 'return=representation'
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!response.ok) throw Error('Не удалось ' + (method === 'GET' ? 'загрузить' : 'изменить') + ' заметки. Попробуй ещё раз.');
    return response.json();
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
    $('editor').hidden = false;
    render();
    $(note ? 'body' : 'title').focus();
  }

  function close() {
    selected = null;
    $('editor').hidden = true;
    $('title').value = '';
    $('body').value = '';
    $('editor-status').textContent = '';
    render();
  }

  function setBusy(value) {
    busy = value;
    for (const id of ['save','delete','cancel','new-note','title','body']) $(id).disabled = value;
  }

  async function load() {
    const run = ++epoch;
    userId = null;
    notes = [];
    close();
    setBusy(false);
    for (const id of ['workspace','new-note','login','retry']) $(id).hidden = true;
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
      $('status').textContent = error.message;
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
    if (!value.title && !value.body) {
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
