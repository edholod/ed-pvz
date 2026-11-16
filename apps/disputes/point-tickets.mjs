const tabs = [
 { id: 'withholding', label: 'Удержания' },
 { id: 'other', label: 'Все остальные' }
];

const withholdingTopic = /удержан|зависш|брак[а-яё]*|подмен/i;

function pointKey(row) {
 return JSON.stringify([row.organization_research_id, String(row.wb_point_id)]);
}

function ticketKey(row, number) {
 return JSON.stringify([pointKey(row), String(number)]);
}

function dateKey(value) {
 const date = String(value ?? '').match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}:\d{2}))?/);
 return date ? `${date[3]}-${date[2]}-${date[1]} ${date[4] ?? ''}` : '';
}

export function groupPointTickets(tickets, observations) {
 const numbers = new Set(observations.filter(row => row.raw?.ticket_number)
  .map(row => ticketKey(row, row.raw.ticket_number)));
 const groups = new Map();
 const sorted = [...tickets].sort((a, b) => dateKey(b.created_local).localeCompare(dateKey(a.created_local)));
 for (const ticket of sorted) {
  const key = pointKey(ticket);
  if (!groups.has(key)) groups.set(key, { withholding: [], other: [] });
  const group = ticket.linked_withholding || withholdingTopic.test(ticket.title ?? '') || numbers.has(ticketKey(ticket, ticket.ticket_number))
   ? 'withholding' : 'other';
  groups.get(key)[group].push(ticket);
 }
 return groups;
}

export function renderPointTickets(point, groups, scopes, failed, activeTab = 'withholding', esc) {
 const tickets = groups.get(pointKey(point)) ?? { withholding: [], other: [] };
 const scopePrefix = `wb:${point.organization_research_id}:${point.wb_point_id}:tickets:`;
 const checks = ['legacy', 'new'].map(namespace => scopes.find(scope => scope.scope === scopePrefix + namespace));
 const checked = checks.every(scope => scope?.last_success)
  ? Math.min(...checks.map(scope => Date.parse(scope.last_success))) : null;
 const date = checked ? new Date(checked).toLocaleString('ru-RU', {
  timeZone: 'Europe/Moscow', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
 }) : '';
 const stale = checked && Date.now() - checked > 6 * 60 * 60 * 1000;
 const status = failed ? 'Не удалось обновить тикеты. Показаны последние загруженные данные.'
  : checks.every(scope => scope?.state === 'ok') && date ? (stale ? 'Данные могут быть устаревшими. ' : '') + 'Оба списка WB проверены ' + date + ' МСК.'
  : 'Проверка обоих списков WB ещё не завершена.';
 return `<section class="point-tickets">
  <h3>Тикеты</h3>
  <p class="point-tickets-status">${esc(status)}</p>
  <div class="point-ticket-tabs" role="group" aria-label="Категории тикетов">${tabs.map(({ id, label }) =>
   `<button type="button" data-ticket-tab="${id}" aria-pressed="${id === activeTab}">${label} <span>${tickets[id].length}</span></button>`
  ).join('')}</div>
  ${tabs.map(({ id, label }) => `<div data-ticket-panel="${id}" aria-label="${label}"${id !== activeTab ? ' hidden' : ''}>${
   tickets[id].length ? `<ul class="point-ticket-list">${tickets[id].map(ticket => `<li><strong>${esc(ticket.title?.trim() || 'Тема не указана в WB')}</strong>
    <div class="point-ticket-meta"><span>№ ${esc(ticket.ticket_number)}</span><span>${ticket.namespace === 'new' ? 'Обращения WB' : 'Тикеты WB'}</span><span>${esc(ticket.created_local || '')}</span></div>
    <span class="point-ticket-state">${esc(ticket.status)}</span></li>`).join('')}</ul>`
   : '<p class="empty">Активные тикеты в этой вкладке пока не найдены.</p>'
  }</div>`).join('')}
 </section>`;
}
