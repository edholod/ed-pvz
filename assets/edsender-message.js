(() => {
  'use strict';

  function action(className, label, path, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.title = label;
    button.setAttribute('aria-label', label + ' сообщение');
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + path + '"/></svg>';
    button.onclick = onClick;
    return button;
  }

  function archiveLink(body) {
    if (typeof body !== 'string' || !body.startsWith(location.origin + '/apps/surveillance/archive-share.html#')) return null;
    try {
      const url = new URL(body);
      if (url.origin !== location.origin || url.pathname !== '/apps/surveillance/archive-share.html' || !url.hash) return null;
      const link = document.createElement('a');
      link.href = url.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Посмотреть запись камеры';
      return link;
    } catch {
      return null;
    }
  }

  function render(message, {selection, author, delivery = '', onForward, onDelete, onError}) {
    const deleted = !!message.deleted_at || message.body === 'Сообщение удалено';
    const bubble = document.createElement('div');
    bubble.className = 'bubble' + (message.is_mine ? ' mine' : '') + (deleted ? ' deleted-message' : '');
    selection.decorate(bubble, message.id, message.body, deleted);

    if (author && !message.is_mine) {
      const name = document.createElement('strong');
      name.className = 'bubble-author';
      name.textContent = author;
      bubble.append(name);
    }

    const attachment = deleted ? null : (
      archiveLink(message.body) ||
      window.EdPVZChatTask.render(message.body) ||
      window.EdPVZChatQR.render(message.body) ||
      window.EdPVZChatLocation.render(message.body) ||
      window.EdPVZChatDispute.render(message.body) ||
      window.EdPVZChatImage.render(message.body) ||
      window.EdPVZVoice.render(message.body)
    );
    const text = document.createElement('span');
    text.className = 'bubble-text';
    text.textContent = message.body;
    const meta = document.createElement('small');
    meta.textContent = new Date(message.created_at).toLocaleString('ru-RU', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    }) + (deleted ? '' : delivery);
    bubble.append(attachment || text, meta);

    if (!deleted) {
      bubble.append(action('message-forward', 'Переслать',
        'M14 5l7 7-7 7v-4c-6 0-9 1.5-12 5 1-8 5-12 12-12V5z', onForward));
      if (message.is_mine) {
        bubble.append(action('message-delete', 'Удалить',
          'M4 7h16M10 4h4m-8 3 1 13h10l1-13M10 11v6m4-6v6', async () => {
            if (!confirm('Удалить сообщение у всех участников переписки?')) return;
            try { await onDelete(); } catch (error) { onError(error.message); }
          }));
      }
    }
    return bubble;
  }
  window.EdSenderMessage = {render};
})();
