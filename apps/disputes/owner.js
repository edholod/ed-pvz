import { STATUSES, STATUS_CLASSES, initialNote, monthKey, monthGroups, photoPath, sourceMatches } from './cards-model.mjs?v=manual-hanging-1';

const $ = id => document.getElementById(id);
const account = window.EdPVZAccount;
const status = $('owner-status');
const workspace = $('owner-workspace');
const picker = $('owner-organization');
const cases = $('owner-cases');
const filterIds = ['owner-search', 'owner-point', 'owner-month', 'owner-state', 'owner-wb'];
const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' });
const photoBase = 'https://raw.githubusercontent.com/edholod/ed-pvz/main/';
let userId = null;
let listVersion = 0;
let pageVersion = 0;
let points = [];
let rows = [];

function clearCases() {
  pageVersion++;
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
  let count = 0;

  for (const row of rows) {
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

  const sections = points.filter(point => !filtering || grouped.has(point.id)).map(point => {
    const section = node('details', null, 'point');
    section.dataset.point = point.id;
    section.open = filtering || points.length === 1 || expanded.has(point.id);
    const pointRows = grouped.get(point.id) || [];
    const summary = node('summary');
    summary.append(node('span', (point.name || 'ПВЗ') + ' · ' + point.id), node('span', String(pointRows.length), 'point-count'));
    const content = node('div', null, 'point-months');
    if (!pointRows.length) content.append(node('p', 'Удержаний в работе нет.', 'empty'));
    for (const group of monthGroups(pointRows, rowNote)) {
      const heading = node('h3', group.label + ' · ' + group.rows.length, 'month-heading');
      const cards = node('div', null, 'cases');
      cards.append(...group.rows.map(card));
      content.append(heading, cards);
    }
    section.append(summary, content);
    return section;
  });

  cases.replaceChildren(...sections);
  if (filtering && !count) cases.append(node('p', 'По выбранным условиям удержаний нет.', 'empty'));
  $('owner-reset').hidden = !filtering;
  $('owner-count').textContent = 'Показано: ' + count + ' из ' + rows.length;
}

async function loadRows() {
  const organization = picker.value;
  if (!organization) return;
  clearCases();
  notes.clear();
  const version = pageVersion;
  const uid = userId;
  const collected = [];
  let cursor = null;
  status.textContent = 'Загружаем удержания…';

  try {
    for (;;) {
      const page = await account.rpc('edpvz_dispute_owner_access', {
        p_action: 'read', p_org: organization, p_after: cursor
      });
      if (version !== pageVersion || uid !== account.user?.id) return;
      points = page.points;
      collected.push(...page.rows);
      if (page.rows.length < 100) break;
      const next = page.rows.at(-1).id;
      if (!next || next === cursor) throw Error('Не удалось дочитать список');
      cursor = next;
    }
    rows = collected;
    for (const row of rows) {
      const fallback = initialNote({ raw: { date_label: row.date_label } });
      notes.set(row.id, { status: row.status || STATUSES[0], withholding_date: row.deadline || fallback.withholding_date });
    }
    fillFilters();
    render();
    status.textContent = points.length ? '' : 'Для этого собственника пока нет подключённых ПВЗ.';
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

async function loadAccess(reload = false) {
  const uid = account.user?.id || null;
  if (uid !== userId) {
    clearCases();
    picker.replaceChildren();
    workspace.hidden = true;
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
    const wasHidden = workspace.hidden;
    picker.replaceChildren(...access.map(org => new Option(org.name, org.id)));
    workspace.hidden = access.length === 0;
    if (!access.length) {
      clearCases();
      status.textContent = 'Введи код доступа в поиске на главной странице.';
      return;
    }
    if (access.some(org => org.id === previous)) picker.value = previous;
    if (reload || wasHidden || previous !== picker.value) void loadRows();
  } catch {
    if (version === listVersion && workspace.hidden) status.textContent = 'Не удалось проверить доступ. Обнови страницу.';
  }
}

setOptions($('owner-state'), 'Все статусы', STATUSES.map(state => ({ label: state, value: state })));
for (const id of filterIds) $(id).addEventListener(id === 'owner-search' ? 'input' : 'change', render);
$('owner-reset').addEventListener('click', () => {
  for (const id of filterIds) $(id).value = '';
  render();
});
picker.addEventListener('change', () => {
  for (const id of filterIds) $(id).value = '';
  void loadRows();
});
$('owner-refresh').addEventListener('click', () => loadAccess(true));
window.addEventListener('edpvz-auth-changed', () => loadAccess());
window.addEventListener('focus', () => loadAccess());
window.addEventListener('pageshow', () => loadAccess());
setInterval(() => { if (!document.hidden) void loadAccess(); }, 30000);
void loadAccess();
