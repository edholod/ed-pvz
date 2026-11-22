import { monthLabel } from './cards-model.mjs?v=manual-hanging-1';

const sections = [
  ['disputes', 'Оспаривание'],
  ['tickets', 'Тикеты'],
  ['withheld', 'Удержано'],
  ['paid', 'Доплачено']
];
const moneyFormats = new Map();
function currencyCode(row) { return ['RUB', 'BYN', 'KGS', 'AMD'].includes(row.currency) ? row.currency : 'RUB'; }
function money(amount, currency) {
  if (!moneyFormats.has(currency)) moneyFormats.set(currency, new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 2 }));
  return moneyFormats.get(currency).format(Number(amount));
}
function operationKey(row) { return [row.shk, Number(row.amount), currencyCode(row)].join('|'); }

export function renderPointSections(point, active, disputes, tickets) {
  const archive = 'Загружаем историю WB…';
  const bodies = { disputes, tickets, paid: '<p class="empty">' + archive + '</p>', withheld: '<p class="empty">' + archive + '</p>' };
  return `<div class="point-sections" data-point-archive data-archive-point="${String(point.wb_point_id).replace(/[^0-9]/g, '')}">
    <div class="point-section-tabs" role="group" aria-label="Разделы ПВЗ">
      ${sections.map(([id, label]) => `<button type="button" data-point-tab="${id}" aria-pressed="${id === active}">${label}</button>`).join('')}
    </div>
    ${sections.map(([id, label]) => `<section data-point-panel="${id}" aria-label="${label}"${id === active ? '' : ' hidden'}>${bodies[id]}</section>`).join('')}
  </div>`;
}

function element(tag, text, className) {
  const item = document.createElement(tag);
  if (text) item.textContent = text;
  if (className) item.className = className;
  return item;
}

function formatDate(value) {
  return value?.split('-').reverse().join('.') || '';
}

function paintArchive(panel, rows) {
  const label = panel.getAttribute('aria-label');
  const isWithheld = panel.dataset.pointPanel === 'withheld';
  const compensations = new Map();
  for (const row of rows.filter(row => row.operation_type === 'Доплачено')) {
    const key = operationKey(row);
    compensations.set(key, (compensations.get(key) || 0) + 1);
  }
  const operations = rows.filter(row => {
    if (row.operation_type !== label) return false;
    if (!isWithheld) return true;
    if (row.paid) return false;
    const key = operationKey(row);
    const remaining = compensations.get(key) || 0;
    if (remaining > 0) { compensations.set(key, remaining - 1); return false; }
    return true;
  });
  if (!operations.length) {
    panel.replaceChildren(element('p', 'Операций в загруженной истории нет.', 'empty'));
    return;
  }
  const totals = new Map();
  for (const row of operations) { const code = currencyCode(row); totals.set(code, (totals.get(code) || 0) + Number(row.amount)); }
  const heading = element('p', operations.length + ' операций · ' + [...totals].map(([code, sum]) => money(sum, code)).join(' · '), 'point-archive-total');
  const lists = new Map();
  for (const row of operations) {
    const month = row.operation_date?.slice(0, 7) || '';
    if (!lists.has(month)) lists.set(month, element('ul', '', 'point-archive-list'));
    const item = element('li', '', 'point-archive-row');
    const date = [formatDate(row.operation_date), row.operation_time?.slice(0, 5)].filter(Boolean).join(' ');
    const shk=element('strong', 'ШК ' + row.shk);
    const copy=element('button','⧉ Копировать','copy-number');copy.type='button';copy.dataset.copyNumber=String(row.shk||'');
    item.append(shk,copy,element('strong', money(row.amount, currencyCode(row))), element('small', date));
    const details = [
      row.cell && 'Ячейка ' + row.cell,
      row.return_box && 'Коробка возврата ' + row.return_box,
      row.accept_box && 'Коробка приёмки ' + row.accept_box
    ].filter(Boolean);
    if (details.length) item.append(element('small', details.join(' · ')));
    lists.get(month).append(item);
  }
  const months = [...lists.keys()].sort((a, b) => b.localeCompare(a)).map(month => {
    const group = element('section', '', 'point-archive-month');
    group.append(element('h3', month ? monthLabel(month) : 'Без даты операции', 'month-heading'), lists.get(month));
    return group;
  });
  panel.replaceChildren(heading, ...months);
}

export function bindPointSections(root, account, pointKey) {
  const selected = new Map();
  const archive = new Map();
  let userId;

  async function hydrate() {
    const uid = account.user?.id;
    if (uid !== userId) {
      userId = uid;
      archive.clear();
    }
    const panels = root.querySelectorAll('[data-point-archive] > [data-point-panel="paid"]:not([hidden]), [data-point-archive] > [data-point-panel="withheld"]:not([hidden])');
    await Promise.all([...panels].map(async panel => {
      if (!uid || panel.dataset.loaded) return;
      const pointId = panel.closest('[data-archive-point]')?.dataset.archivePoint;
      if (!pointId) return;
      const archiveQuery = 'edpvz_owner_stuck_history?wb_point_id=eq.' + encodeURIComponent(pointId)
        + '&select=operation_type,shk,amount,currency,operation_date,operation_time,cell,return_box,accept_box,paid'
        + '&order=operation_date.desc,operation_time.desc,source_row.desc&limit=1000';
      const request = archive.get(pointId) ?? (async () => {
        const all = [];
        for (let offset = 0; offset < 100000; offset += 1000) {
          const page = await account.readTable(archiveQuery + '&offset=' + offset);
          all.push(...page);
          if (page.length < 1000) return all;
        }
        throw Error('Превышен лимит истории');
      })();
      archive.set(pointId, request);
      try {
        const rows = await request;
        if (uid !== account.user?.id || !panel.isConnected) return;
        paintArchive(panel, rows);
        panel.dataset.loaded = 'true';
      } catch {
        if (archive.get(pointId) === request) archive.delete(pointId);
        if (uid === account.user?.id && panel.isConnected) {
          panel.replaceChildren(element('p', 'Не удалось загрузить историю WB. Открой вкладку ещё раз.', 'empty'));
        }
      }
    }));
  }

  root.addEventListener('click', event => {
    const button = event.target.closest('[data-point-tab]');
    if (!button) return;
    const group = button.closest('.point-sections');
    const active = button.dataset.pointTab;
    selected.set(pointKey(group.closest('[data-point]').dataset.point), active);
    for (const item of group.querySelectorAll('[data-point-tab]')) item.setAttribute('aria-pressed', String(item === button));
    for (const panel of group.querySelectorAll('[data-point-panel]')) panel.hidden = panel.dataset.pointPanel !== active;
    void hydrate();
  });

  return {
    active: point => selected.get(pointKey(point)) ?? 'disputes',
    hydrate,
    clear() {
      selected.clear();
      archive.clear();
    }
  };
}
