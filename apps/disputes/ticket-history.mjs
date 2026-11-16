function element(tag, text, className) {
 const item = document.createElement(tag);
 if (text) item.textContent = text;
 if (className) item.className = className;
 return item;
}

const roles = { user: 'Автор обращения', wb_support: 'Поддержка WB', system: 'Система', unknown: 'Участник' };

export function createTicketHistory(load) {
 const dialog = element('dialog', '', 'ticket-history');
 const heading = element('h2');
 heading.id = 'ticket-history-title';
 dialog.setAttribute('aria-labelledby', heading.id);
 const close = element('button', 'Закрыть');
 close.type = 'button';
 close.onclick = () => dialog.close();
 const header = element('div', '', 'ticket-history-head');
 header.append(heading, close);
 const state = element('p');
 state.setAttribute('role', 'status');
 const list = element('ol', '', 'ticket-history-messages');
 dialog.append(header, state, list);
 document.body.append(dialog);
 let version = 0;
 dialog.addEventListener('close', () => { if (!dialog.open) { version++; list.replaceChildren(); } });

 return {
  close() { if (dialog.open) dialog.close(); version++; list.replaceChildren(); },
  async open(id, title) {
   if (!id) return;
   const current = ++version;
   heading.textContent = title;
   list.replaceChildren();
   state.textContent = 'Загружаем переписку…';
   if (!dialog.open) dialog.showModal();
   try {
    const data = await load(id);
    if (version !== current || !dialog.open) return;
    heading.textContent = '№ ' + data.ticket_number + ' · ' + (data.title || title);
    list.replaceChildren(...(data.messages || []).map(message => {
     const item = element('li');
     const author = message.raw?.author_label || roles[message.author_role] || roles.unknown;
     const date = message.message_at ? new Date(message.message_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : '';
     item.append(element('strong', author), element('small', date), element('p', message.message_text));
     for (const value of message.raw?.attachments || []) {
      let url;
      try { url = new URL(value); } catch { continue; }
      if (url.protocol !== 'https:') continue;
      const link = element('a', 'Открыть вложение');
      link.href = url.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      item.append(link);
     }
     return item;
    }));
    state.textContent = list.children.length
     ? (data.history_complete ? '' : 'Показаны сохранённые сообщения. WB ещё проверяется.')
     : (data.history_complete ? 'В сохранённой переписке нет сообщений.' : 'Переписка ещё не загружена из WB. Проверь после обновления.');
   } catch {
    if (version === current && dialog.open) state.textContent = 'Не удалось загрузить переписку. Закрой и открой тикет ещё раз.';
   }
  }
 };
}
