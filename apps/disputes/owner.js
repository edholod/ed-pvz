import { initialNote } from './cards-model.mjs?v=20261110-source';

const $ = id => document.getElementById(id);
const account = window.EdPVZAccount;
const status = $('owner-status');
const workspace = $('owner-workspace');
const picker = $('owner-organization');
const cases = $('owner-cases');
const more = $('owner-more');
const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' });
let userId = null;
let listVersion = 0;
let pageVersion = 0;
let points = [];
let rows = [];
let next = null;

function clearCases() {
  pageVersion++;
  points = [];
  rows = [];
  next = null;
  more.hidden = true;
  cases.replaceChildren();
}

function node(tag, value) {
  const element = document.createElement(tag);
  if (value != null) element.textContent = value;
  return element;
}

function render() {
  const expanded = new Set([...cases.querySelectorAll('details[open]')].map(point => point.dataset.point));
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.point_id)) grouped.set(row.point_id, []);
    grouped.get(row.point_id).push(row);
  }
  const sections = points.map(point => {
    const section = node('details');
    section.className = 'point';
    section.dataset.point = point.id;
    section.open = points.length === 1 || expanded.has(point.id);
    section.append(node('summary', (point.name || 'ПВЗ') + ' · ' + point.id));
    const content = node('div');
    content.className = 'point-months';
    const pointRows = grouped.get(point.id) || [];
    if (pointRows.length === 0) {
      content.append(node('p', next ? 'В загруженной части списка удержаний нет.' : 'Удержаний в работе нет.'));
    }
    for (const row of pointRows) {
      const card = node('article');
      card.className = 'case';
      const deadline = row.deadline || initialNote({ raw: { date_label: row.date_label } }).withholding_date;
      card.append(node('h3', row.title || 'Товар WB'));
      card.append(node('p', [
        row.barcode && 'ШК / стикер ' + row.barcode,
        row.amount != null && money.format(Number(row.amount)),
        row.category
      ].filter(Boolean).join(' · ')));
      if (deadline) card.append(node('p', 'Обращение до ' + deadline.split('-').reverse().join('.')));
      if (row.status) card.append(node('p', row.status));
      if (row.ticket) card.append(node('p', 'Тикет № ' + row.ticket));
      content.append(card);
    }
    section.append(content);
    return section;
  });
  cases.replaceChildren(...sections);
  more.hidden = !next;
}

async function loadPage(append = false) {
  const organization = picker.value;
  if (!organization) return;
  if (!append) clearCases();
  const version = ++pageVersion;
  const uid = userId;
  more.disabled = true;
  status.textContent = 'Загружаем удержания…';
  try {
    const page = await account.rpc('edpvz_dispute_owner_access', {
      p_action: 'read', p_org: organization, p_after: append ? next : null
    });
    if (version !== pageVersion || uid !== account.user?.id) return;
    points = page.points;
    rows = append ? rows.concat(page.rows) : page.rows;
    next = page.rows.length === 100 ? page.rows.at(-1).id : null;
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
  } finally {
    if (version === pageVersion) more.disabled = false;
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
    status.textContent = 'Войди в аккаунт, в котором активирован код.';
    return;
  }
  try {
    const access = await account.rpc('edpvz_dispute_owner_access', { p_action: 'list' });
    if (version !== listVersion || uid !== account.user?.id) return;
    const previous = picker.value;
    const wasHidden = workspace.hidden;
    picker.replaceChildren(...access.map(org => {
      const option = node('option', org.name);
      option.value = org.id;
      return option;
    }));
    workspace.hidden = access.length === 0;
    if (!access.length) {
      clearCases();
      status.textContent = 'Введи код доступа в поиске на главной странице.';
      return;
    }
    if (access.some(org => org.id === previous)) picker.value = previous;
    if (reload || wasHidden || previous !== picker.value) void loadPage();
  } catch {
    if (version === listVersion && workspace.hidden) status.textContent = 'Не удалось проверить доступ. Обнови страницу.';
  }
}

picker.addEventListener('change', () => loadPage());
$('owner-refresh').addEventListener('click', () => loadAccess(true));
more.addEventListener('click', () => { if (next) void loadPage(true); });
window.addEventListener('edpvz-auth-changed', () => loadAccess());
window.addEventListener('focus', () => loadAccess());
window.addEventListener('pageshow', () => loadAccess());
setInterval(() => { if (!document.hidden) void loadAccess(); }, 30000);
void loadAccess();
