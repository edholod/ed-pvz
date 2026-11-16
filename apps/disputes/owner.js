import { createTicketHistory } from './ticket-history.mjs';
import { groupPointTickets, renderUrgentTickets, renderOtherOwnerTickets, updateReplyCountdowns } from './point-tickets.mjs?v=6';
import { STATUSES, STATUS_CLASSES, initialNote, monthKey, monthGroups, photoPath, sourceMatches } from './cards-model.mjs?v=manual-hanging-1';

const $ = id => document.getElementById(id);
const account = window.EdPVZAccount;
const status = $('owner-status');
const workspace = $('owner-workspace');
const picker = $('owner-organization');
const cases = $('owner-cases');
const content = $('owner-content');
const historyPanel = $('owner-history');
const historyResults = $('owner-history-results');
const historySearch = $('owner-history-search');
const ticketsPanel = $('owner-tickets');
const tabButtons = [...document.querySelectorAll('[data-owner-tab]')];
const scopesByOrg = new Map();
let organizations = [];
let currentTab = 'dispute';
let historyRows = null;
let historyVersion = 0;
let ticketsVersion = 0;
const admin = '0f75065b-2b26-4a87-bf26-005f5a2284d4';
const filterIds = ['owner-search', 'owner-point', 'owner-month', 'owner-state', 'owner-wb'];
const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' });
const photoBase = 'https://raw.githubusercontent.com/edholod/ed-pvz/main/';
let userId = null;
let listVersion = 0;
let pageVersion = 0;
let points = [];
let rows = [];
let stuckOnly = false;
let displayedOrganization = null;
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

const ticketHistory = createTicketHistory(id => {
  const org = [...scopesByOrg].find(([, snapshot]) => snapshot.tickets.some(ticket => String(ticket.id) === id))?.[0];
  if (!org) throw Error('Тикет недоступен');
  return account.rpc('edpvz_dispute_owner_access', { p_action: 'ticket_history', p_org: org, p_after: id });
});

function clearCases() {
  ticketHistory.close();
  pageVersion++;
  displayedOrganization = null;
  notes.clear();
  points = [];
  rows = [];
  $('owner-count').textContent = '';
  cases.replaceChildren();
}

function node(tag, value, className) {
  const element = document.createElement(tag);
  if (value != null) element.textContent = value;
  if (className) element.className = className;
  return element;
}

function setOptions(select, first, options) {
  const previous = select.value;
  select.replaceChildren(new Option(first, ''), ...options.map(option => new Option(option.label, option.value)));
  if (options.some(option => option.value === previous)) select.value = previous;
}

function fillFilters() {
  setOptions($('owner-point'), 'Все ПВЗ', points.map(point => ({
    label: (point.name || 'ПВЗ') + ' · ' + point.id, value: point.id
  })));
  setOptions($('owner-month'), 'Все месяцы', monthGroups(rows, rowNote).map(group => ({
    label: group.label, value: group.key
  })));
}

const rowNote = id => notes.get(id);
const notes = new Map();

function photo(row) {
  const box = node('div', 'Без фото', 'photo-box');
  if (!row.photo_url) return box;
  void photoPath(row.photo_url).then(path => {
    if (!path) return;
    const source = new URL(row.photo_url);
    if (source.username || source.password || !/^[a-z0-9.-]+\.(wbbasket|wb|wildberries)\.ru$/i.test(source.hostname)) return;
    const image = node('img');
    image.alt = 'Фото товара';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => {
      image.addEventListener('error', () => { box.textContent = 'Фото недоступно'; }, { once: true });
      image.src = source.href;
    }, { once: true });
    image.src = photoBase + path;
    box.replaceChildren(image);
  }).catch(() => {});
  return box;
}

function card(row) {
  const note = rowNote(row.id);
  const color = STATUS_CLASSES[STATUSES.indexOf(note.status)] || 'new';
  const article = node('article', null, 'case ' + color);
  const summary = node('div', null, 'case-summary');
  const facts = node('div', null, 'case-facts');
  facts.append(node('h3', row.title || 'Товар WB'));
  const fields = node('dl');
  const deadline = note.withholding_date ? note.withholding_date.split('-').reverse().join('.') : '—';
  for (const [label, value] of [
    ['ШК / стикер', row.barcode || '—'],
    ['Стоимость', row.amount != null ? money.format(Number(row.amount)) : '—'],
    ['Обращение до', deadline]
  ]) {
    const field = node('div');
    field.append(node('dt', label), node('dd', value));
    fields.append(field);
  }
  facts.append(fields, node('p', row.category, 'compact-type'), node('span', note.status, 'status-badge'));
  if (row.wb_ticket_number) {
    const wb = 'WB: обращение № ' + row.wb_ticket_number + (row.wb_ticket_status ? ' · ' + row.wb_ticket_status : '');
    facts.append(node('div', wb, 'wb-ticket'));
  }
  if (row.ticket && row.ticket !== row.wb_ticket_number) facts.append(node('div', 'Тикет № ' + row.ticket, 'wb-ticket'));
  summary.append(photo(row), facts);
  article.append(summary);
  const annotations = [
    ['Вина сотрудника', row.employee_fault],
    ['Комментарий', row.comment]
  ].filter(([, value]) => value?.trim());
  if (annotations.length) {
    const details = node('dl', null, 'owner-annotations');
    for (const [label, value] of annotations) {
      const entry = node('div');
      entry.append(node('dt', label), node('dd', value));
      details.append(entry);
    }
    article.append(details);
  }
  return article;
}

function render() {
  const [query, pointId, month, state, wb] = filterIds.map(id => $(id).value.trim());
  const search = query.toLocaleLowerCase('ru');
  const filtering = Boolean(query || pointId || month || state || wb);
  const expanded = new Set([...cases.querySelectorAll('details[open]')].map(point => point.dataset.point));
  const addresses = new Map(points.map(point => [point.id, point.name]));
  const grouped = new Map();
  const visibleRows = stuckOnly ? rows.filter(row => row.category === 'Зависший') : rows;
  let count = 0;

  for (const row of visibleRows) {
    const note = rowNote(row.id);
    if (pointId && row.point_id !== pointId) continue;
    if (month && monthKey(note) !== month) continue;
    if (state && note.status !== state) continue;
    if (!sourceMatches({ wb_ticket: { number: row.wb_ticket_number, status: row.wb_ticket_status } }, wb)) continue;
    const haystack = [row.title, row.barcode, row.ticket, row.wb_ticket_number, row.category, row.point_id, addresses.get(row.point_id)];
    if (search && !haystack.some(value => String(value || '').toLocaleLowerCase('ru').includes(search))) continue;
    if (!grouped.has(row.point_id)) grouped.set(row.point_id, []);
    grouped.get(row.point_id).push(row);
    count++;
  }

  const sections = points.filter(point => pointId ? point.id === pointId : !filtering || grouped.has(point.id)).map(point => {
    const section = node('details', null, 'point');
    section.dataset.point = point.id;
    section.open = filtering || points.length === 1 || expanded.has(point.id);
    const pointRows = grouped.get(point.id) || [];
    const summary = node('summary');
    summary.append(node('span', (point.name || 'ПВЗ') + ' · ' + point.id), node('span', String(pointRows.length), 'point-count'));
    const content = node('div', null, 'point-months');
    if (!pointRows.length) content.append(node('p', stuckOnly ? 'Зависших товаров по этому ПВЗ нет.' : 'Удержаний в работе нет.', 'empty'));
    for (const group of monthGroups(pointRows, rowNote)) {
      const heading = node('h3', group.label + ' · ' + group.rows.length, 'month-heading');
      const cards = node('div', null, 'cases');
      cards.append(...group.rows.map(card));
      content.append(heading, cards);
    }
    section.append(summary);
    section.append(content);
    return section;
  });

  cases.replaceChildren(...sections);
  if (filtering && !count) cases.append(node('p', 'По выбранным условиям удержаний нет.', 'empty'));
  $('owner-reset').hidden = !filtering;
  $('owner-count').textContent = 'Показано товаров: ' + count + ' из ' + visibleRows.length;
}

async function loadRows() {
  const organization = picker.value;
  if (!organization) return;
  if (displayedOrganization !== organization) clearCases();
  const version = ++pageVersion;
  const uid = userId;
  const collected = [];
  let nextPoints = [];
  let cursor = null;
  if (displayedOrganization !== organization) status.textContent = 'Загружаем удержания…';

  try {
    for (;;) {
      const page = await account.rpc('edpvz_dispute_owner_access', {
        p_action: 'read', p_org: organization, p_after: cursor
      });
      if (version !== pageVersion || uid !== account.user?.id) return;
      nextPoints = page.points;
      collected.push(...page.rows);
      if (page.rows.length < 100) break;
      const next = page.rows.at(-1).id;
      if (!next || next === cursor) throw Error('Не удалось дочитать список');
      cursor = next;
    }
    status.textContent = nextPoints.length ? '' : 'Для этого собственника пока нет подключённых ПВЗ.';
    if (displayedOrganization === organization && JSON.stringify([points, rows]) === JSON.stringify([nextPoints, collected])) return;
    displayedOrganization = organization;
    points = nextPoints;
    rows = collected;
    notes.clear();
    for (const row of rows) {
      const fallback = initialNote({ raw: { date_label: row.date_label } });
      notes.set(row.id, { status: row.status || STATUSES[0], withholding_date: row.deadline || fallback.withholding_date });
    }
    fillFilters();
    render();
  } catch (error) {
    if (version !== pageVersion) return;
    if (error.status === 403 || error.status === 401) {
      clearCases();
      workspace.hidden = true;
      status.textContent = 'Доступ к этому разделу закрыт.';
    } else {
      status.textContent = 'Не удалось загрузить удержания. Попробуй обновить.';
    }
  }
}

function adminLink(label) {
  const link = node('a', label, 'primary');
  link.href = './';
  return link;
}

function updateTab() {
  const canReadDisputes = organizations.length > 0;
  workspace.hidden = currentTab !== 'dispute' || !canReadDisputes;
  $('owner-organization-tools').hidden = !canReadDisputes;
  historyPanel.hidden = !['paid', 'withheld'].includes(currentTab);
  ticketsPanel.hidden = currentTab !== 'tickets';
  for (const button of tabButtons) button.setAttribute('aria-pressed', String(button.dataset.ownerTab === currentTab));
  $('owner-admin-entry').hidden = userId !== admin || canReadDisputes || currentTab !== 'dispute';
}

function renderHistory() {
  if (!['paid', 'withheld'].includes(currentTab)) return;
  historyResults.replaceChildren();
  $('owner-history-controls').hidden = true;
  const type = currentTab === 'paid' ? 'Доплачено' : 'Удержано';
  if ((organizations.length && picker.value !== 'org01') || (userId !== admin && !organizations.some(org => org.id === 'org01'))) {
    historyResults.append(node('p', 'Для выбранного собственника пока нет загруженной истории WB.', 'empty'));
    return;
  }
  if (!historyRows) {
    historyResults.append(node('p', 'Загружаем историю WB…', 'empty'));
    return;
  }
  $('owner-history-controls').hidden = false;
  const operations = historyRows.filter(row => row.operation_type === type);
  const search = historySearch.value.trim();
  const items = operations.filter(row => !search || String(row.shk).includes(search));
  const heading = node('div', null, 'owner-history-summary');
  heading.append(node('h2', type), node('strong', money.format(operations.reduce((sum, row) => sum + Number(row.amount), 0))));
  historyResults.append(node('p', 'Сочи, ул. Роз, 41 · Загруженная история зависших'), heading);
  if (!items.length) {
    historyResults.append(node('p', search ? 'По этому ШК операций нет.' : 'В загруженной истории таких операций нет.', 'empty'));
    return;
  }
  const list = node('ul', null, 'owner-history-list');
  for (const item of items) {
    const row = node('li', null, 'owner-history-row');
    const date = item.operation_date.split('-').reverse().join('.');
    row.append(node('strong', 'ШК ' + item.shk), node('strong', money.format(Number(item.amount))),
      node('small', date + (item.operation_time ? ' · ' + item.operation_time : '') +
        (type !== 'Удержано' ? '' : item.paid ? ' · Есть доплата' : ' · Доплату не нашли')));
    list.append(row);
  }
  historyResults.append(list);
}

async function loadHistory() {
  renderHistory();
  if (historyRows || (organizations.length && picker.value !== 'org01') ||
      (userId !== admin && !organizations.some(org => org.id === 'org01'))) return;
  const version = ++historyVersion;
  const uid = userId;
  try {
    const result = await account.readTable('edpvz_owner_stuck_history?wb_point_id=eq.50034020&select=operation_type,shk,amount,operation_date,operation_time,paid&order=operation_date.desc,source_row.desc&limit=1000');
    if (version !== historyVersion || uid !== account.user?.id) return;
    historyRows = result;
    renderHistory();
  } catch {
    if (version === historyVersion && !historyPanel.hidden) historyResults.replaceChildren(node('p', 'Не удалось загрузить историю WB. Попробуй обновить страницу.', 'empty'));
  }
}

function renderTickets(failed = false) {
  if (currentTab !== 'tickets') return;
  const tickets = [...scopesByOrg.values()].flatMap(snapshot => snapshot.tickets);
  const scopes = [...scopesByOrg.values()].flatMap(snapshot => snapshot.scopes);
  const pointMap = new Map(tickets.map(ticket => {
    const org = ticket.organization_research_id;
    const id = ticket.wb_point_id;
    return [JSON.stringify([org, id]), { organization_research_id: org, wb_point_id: id }];
  }));
  for (const [org, snapshot] of scopesByOrg) {
    for (const point of snapshot.points) pointMap.set(JSON.stringify([org, point.id]), {
      organization_research_id: org, wb_point_id: point.id, name: point.name
    });
  }
  const ticketPoints = [...pointMap.values()];
  ticketsPanel.innerHTML = renderUrgentTickets(groupPointTickets(tickets, []), ticketPoints, escapeHTML, failed, scopes)
    + renderOtherOwnerTickets(tickets, ticketPoints, escapeHTML);
}

async function loadTickets() {
  const version = ++ticketsVersion;
  const uid = userId;
  if (!organizations.length) {
    ticketsPanel.replaceChildren(adminLink('Открыть тикеты в «Удержаниях»'));
    return;
  }
  if (!scopesByOrg.size) ticketsPanel.replaceChildren(node('p', 'Загружаем тикеты…', 'empty'));
  const requested = organizations;
  const requests = requested.map(async org => [org.id, await account.rpc('edpvz_dispute_owner_access', {
    p_action: 'tickets', p_org: org.id
  })]);
  const results = await Promise.allSettled(requests);
  if (version !== ticketsVersion || uid !== account.user?.id) return;
  let failed = false;
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      const [org, snapshot] = result.value;
      scopesByOrg.set(org, { tickets: snapshot.tickets ?? [], scopes: snapshot.scopes ?? [], points: snapshot.points ?? [] });
    } else {
      failed = true;
      if ([401, 403].includes(result.reason?.status)) scopesByOrg.delete(requested[index]?.id);
    }
  });
  renderTickets(failed);
}

async function loadAccess(reload = false) {
  const uid = account.user?.id || null;
  if (uid !== userId) {
    clearCases();
    picker.replaceChildren();
    content.hidden = true;
    organizations = [];
    historyRows = null;
    scopesByOrg.clear();
    historyResults.replaceChildren();
    historySearch.value = '';
    ticketsPanel.replaceChildren();
    historyVersion++;
    ticketsVersion++;
    currentTab = 'dispute';
  }
  userId = uid;
  const version = ++listVersion;
  $('owner-login').hidden = !!uid;
  if (!uid) {
    status.textContent = 'Войди в аккаунт, в котором активирован доступ.';
    return;
  }
  try {
    const access = await account.rpc('edpvz_dispute_owner_access', { p_action: 'list' });
    if (version !== listVersion || uid !== account.user?.id) return;
    const previous = picker.value;
    const wasHidden = content.hidden;
    organizations = access;
    for (const id of scopesByOrg.keys()) if (!access.some(org => org.id === id)) scopesByOrg.delete(id);
    if (uid !== admin && !access.some(org => org.id === 'org01')) historyRows = null;
    picker.replaceChildren(...access.map(org => new Option(org.name, org.id)));
    if (access.some(org => org.id === previous)) picker.value = previous;
    else if (uid === admin && access.some(org => org.id === 'org01')) picker.value = 'org01';
    content.hidden = uid !== admin && !access.length;
    if (content.hidden) {
      clearCases();
      status.textContent = 'Введи код доступа в поиске на главной странице.';
      return;
    }
    updateTab();
    status.textContent = '';
    if (access.length && (reload || wasHidden || previous !== picker.value)) void loadRows();
    if (currentTab === 'tickets') void loadTickets();
    if (['paid', 'withheld'].includes(currentTab)) void loadHistory();
  } catch {
    if (version !== listVersion) return;
    if (uid === admin) {
      content.hidden = false;
      updateTab();
      status.textContent = '';
    } else if (content.hidden) status.textContent = 'Не удалось проверить доступ. Обнови страницу.';
  }
}

for (const button of tabButtons) button.addEventListener('click', () => {
  currentTab = button.dataset.ownerTab;
  historySearch.value = '';
  updateTab();
  if (currentTab === 'tickets') void loadTickets();
  if (['paid', 'withheld'].includes(currentTab)) void loadHistory();
});
historySearch.addEventListener('input', renderHistory);
$('owner-stuck-goods').addEventListener('change', event => {
  stuckOnly = event.target.checked;
  render();
});

setOptions($('owner-state'), 'Все статусы', STATUSES.map(state => ({ label: state, value: state })));
for (const id of filterIds) $(id).addEventListener(id === 'owner-search' ? 'input' : 'change', render);
$('owner-reset').addEventListener('click', () => {
  for (const id of filterIds) $(id).value = '';
  render();
});
ticketsPanel.addEventListener('click', event => {
  const ticket = event.target.closest('[data-open-ticket]');
  if (ticket) void ticketHistory.open(ticket.dataset.openTicket, ticket.textContent);
});
picker.addEventListener('change', () => {
  for (const id of filterIds) $(id).value = '';
  void loadRows();
  if (['paid', 'withheld'].includes(currentTab)) void loadHistory();
});
$('owner-refresh').addEventListener('click', () => loadAccess(true));
window.addEventListener('edpvz-auth-changed', () => loadAccess());
window.addEventListener('focus', () => loadAccess(true));
window.addEventListener('pageshow', () => loadAccess(true));
setInterval(() => { if (!document.hidden) void loadAccess(true); }, 30000);
void loadAccess();

setInterval(() => { if (!document.hidden) updateReplyCountdowns(); }, 1000);
