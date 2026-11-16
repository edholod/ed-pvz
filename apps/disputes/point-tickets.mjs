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
  if (dateKey(ticket.created_local) < '2026-10-01') continue;
  const key = pointKey(ticket);
  if (!groups.has(key)) groups.set(key, { withholding: [], other: [] });
  const group = ticket.linked_withholding || withholdingTopic.test(ticket.title ?? '') || numbers.has(ticketKey(ticket, ticket.ticket_number))
   ? 'withholding' : 'other';
  groups.get(key)[group].push(ticket);
 }
 return groups;
}

export function renderPointTickets(point, groups, scopes, failed, activeTab = 'withholding', esc, urgentAbove = false) {
 const pointTickets = groups.get(pointKey(point)) ?? { withholding: [], other: [] };
 const tickets = urgentAbove ? {
  withholding: pointTickets.withholding.filter(ticket => ticket.reply_state !== 'needs_reply'),
  other: pointTickets.other.filter(ticket => ticket.reply_state !== 'needs_reply')
 } : pointTickets;
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
   tickets[id].length ? renderTicketGroups(tickets[id], esc)
   : '<p class="empty">Активные тикеты в этой вкладке пока не найдены.</p>'
  }</div>`).join('')}
 </section>`;
}


export function replyCountdown(due, now = Date.now()) {
 const remaining = Date.parse(due) - now;
 if (!Number.isFinite(remaining)) return 'Срок неизвестен: WB не передал время ответа';
 if (remaining <= 0) return '72 часа истекли';
 const minutes = Math.ceil(remaining / 60000);
 return minutes < 60 ? `Осталось ${minutes} мин` : `Осталось ${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
}

export function updateReplyCountdowns(root = document) {
 for (const clock of root.querySelectorAll('[data-reply-due]')) {
  clock.textContent = replyCountdown(clock.dataset.replyDue);
  clock.dataset.overdue = String(Date.parse(clock.dataset.replyDue) <= Date.now());
 }
}

function tile(ticket, esc, place = '') {
 const urgent = ticket.reply_state === 'needs_reply';
 const due = ticket.reply_due_at || '';
 return `<li${urgent ? ' class="ticket-needs-reply"' : ''}>
  <button class="point-ticket-open" type="button" data-open-ticket="${esc(ticket.id)}">${esc(ticket.title?.trim() || 'Тема не указана в WB')}</button>
  <div class="point-ticket-meta"><span>№ ${esc(ticket.ticket_number)}</span><span>${esc(place || (ticket.namespace === 'new' ? 'Обращения WB' : 'Тикеты WB'))}</span><span>${esc(ticket.created_local || '')}</span></div>
  <span class="point-ticket-state">${esc(ticket.status)}</span>
  ${urgent ? `<span class="ticket-reply-clock" data-reply-due="${esc(due)}">${esc(replyCountdown(due))}</span>` : ''}
 </li>`;
}

function byDeadline(a, b) {
 return (Date.parse(a.reply_due_at) || Infinity) - (Date.parse(b.reply_due_at) || Infinity);
}

function renderTicketGroups(tickets, esc) {
 const urgent = tickets.filter(ticket => ticket.reply_state === 'needs_reply').sort(byDeadline);
 const answered = tickets.filter(ticket => ticket.reply_state === 'answered');
 const others = tickets.filter(ticket => !['needs_reply', 'answered'].includes(ticket.reply_state));
 return [
  ['Нужно ответить', urgent],
  ['Мы ответили · ждём WB', answered],
  ['Остальные активные', others]
 ].filter(([, list]) => list.length).map(([title, list]) =>
  `<h4 class="ticket-group-title">${title}</h4><ul class="point-ticket-list">${list.map(ticket => tile(ticket, esc)).join('')}</ul>`
 ).join('');
}

export function renderUrgentTickets(groups, points, esc, failed, scopes = []) {
 const addresses = new Map(points.map(point => [pointKey(point), point.address_observed || point.name]));
 const tickets = [...groups.values()].flatMap(group => [...group.withholding, ...group.other])
  .filter(ticket => addresses.has(pointKey(ticket)));
 const urgent = tickets.filter(ticket => ticket.reply_state === 'needs_reply').sort(byDeadline);
 const unknown = tickets.filter(ticket => ticket.reply_state === 'unknown').length;
 const scopeMap = new Map(scopes.map(scope => [scope.scope, scope]));
 const now = Date.now();
 const uncheckedPoints = points.filter(point => ['legacy', 'new'].some(namespace => {
  const scope = scopeMap.get(`wb:${point.organization_research_id}:${point.wb_point_id}:tickets:${namespace}`);
  return scope?.state !== 'ok' || !(now - Date.parse(scope.last_success) <= 6 * 3600000);
 })).length;
 const coverage = [
  unknown ? `Тикетов с неподтверждённым ответом: ${unknown}.` : '',
  uncheckedPoints ? `ПВЗ без полной свежей проверки списков: ${uncheckedPoints} из ${points.length}.` : ''
 ].filter(Boolean).join(' ');
 return `<section class="ticket-urgent"><h3>Горящие тикеты · нужно ответить${urgent.length ? ' · ' + urgent.length : ''}</h3>
  ${coverage || failed ? `<p class="ticket-coverage">${esc(failed ? 'Не удалось обновить данные WB. ' + coverage : coverage)}</p>` : ''}
  ${urgent.length ? `<ul class="point-ticket-list">${urgent.map(ticket => tile(ticket, esc, addresses.get(pointKey(ticket)) || 'ПВЗ ' + ticket.wb_point_id)).join('')}</ul>`
   : '<p>В загруженных переписках тикетов, требующих ответа, нет.</p>'}
 </section>`;
}
