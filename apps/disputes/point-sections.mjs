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

function metric(icon, label, value) {
  const item = element('span', '', 'point-history-metric');
  item.classList.toggle('point-history-barcode', icon === 'barcode.svg');
  item.title = label;
  item.setAttribute('aria-label', label + ': ' + value);
  const marker = element(icon.endsWith('.svg') ? 'img' : 'span', '', 'point-history-icon');
  if (marker.tagName === 'IMG') {
    marker.src = new URL('./operation-icons/' + icon, import.meta.url).href;
    marker.alt = '';
    marker.width = marker.height = 16;
  } else {
    marker.textContent = icon;
  }
  marker.setAttribute('aria-hidden', 'true');
  item.append(marker, element('span', String(value)));
  return item;
}

function operationDate(row) {
  return [formatDate(row.operation_date), row.operation_time?.slice(0, 5)].filter(Boolean).join(' ');
}

function renderOperation(row, history) {
  const details = element('details', '', 'point-history');
  const summary = element('summary', '', 'point-history-summary');
  const metrics = [
    ['date.svg', 'Дата операции', operationDate(row)],
    ['barcode.svg', 'ШК', row.shk],
    ['amount.svg', 'Сумма', row.amount == null ? '—' : money(row.amount, currencyCode(row))],
    ['cell.svg', 'Ячейка', row.cell],
    ['box.svg', 'Коробка возврата', row.return_box],
    ['box.svg', 'Коробка приёмки', row.accept_box],
  ];
  for (const [icon, label, value] of metrics) {
    if (value != null && value !== '') summary.append(metric(icon, label, value));
  }
  const body = element('div', '', 'point-history-body');
  const actions = element('div', '', 'point-history-actions');
  const copy = element('button', 'Копировать ШК', 'copy-number');
  copy.type = 'button';
  copy.dataset.copyNumber = String(row.shk || '');
  actions.append(copy);
  if (/^https:\/\/(?:www\.)?wildberries\.ru\/catalog\/\d+\/detail\.aspx(?:[?#]|$)/i.test(row.product_url || '')) {
    const product = element('a', 'Посмотреть на WB ↗');
    product.href = row.product_url;
    product.target = '_blank';
    product.rel = 'noopener noreferrer';
    actions.append(product);
  }
  if (row.ticket_number) actions.append(element('span', 'Тикет №' + row.ticket_number));
  body.append(actions, element('strong', 'История ШК'));
  const movement = history.find(event => event.movement?.length)?.movement;
  if (movement) {
    const list = element('ol', '', 'point-history-timeline');
    for (const event of movement) {
      const entry = element('li');
      entry.append(element('strong', event.label), element('small', [event.date, event.time].filter(Boolean).join(' · ')));
      list.append(entry);
    }
    body.append(list);
  } else {
    body.append(element('p', 'Движение товара из WB пока не загружено.', 'empty'));
  }
  body.append(element('strong', 'Удержания и доплаты по ШК'));
  const timeline = element('ol', '', 'point-history-timeline');
  for (const event of history.slice().sort((a, b) => operationDateKey(a).localeCompare(operationDateKey(b)))) {
    const item = element('li');
    item.dataset.operation = event.operation_type === 'Доплачено' ? 'paid' : 'withheld';
    item.append(element('strong', event.operation_type), element('span', event.amount == null ? '' : money(event.amount, currencyCode(event))),
      element('small', operationDate(event) || 'Дата не указана'));
    timeline.append(item);
  }
  body.append(timeline);
  details.append(summary, body);
  return details;
}

function operationDateKey(row) {
  return (row.operation_date || '') + ' ' + (row.operation_time || '');
}

function paintArchive(panel, rows) {
  const label = panel.getAttribute('aria-label');
  const isWithheld = panel.dataset.pointPanel === 'withheld';
  const compensated = new Set(rows.filter(row => row.operation_type === 'Доплачено').map(row => String(row.shk)));
  const operations = rows.filter(row => row.operation_type === label
    && (!isWithheld || (!row.paid && !compensated.has(String(row.shk)))));
  if (!operations.length) {
    panel.replaceChildren(element('p', 'Операций в загруженной истории нет.', 'empty'));
    return;
  }
  const totals = new Map();
  for (const row of operations) { const code = currencyCode(row); totals.set(code, (totals.get(code) || 0) + Number(row.amount)); }
  const heading = element('p', operations.length + ' операций · ' + [...totals].map(([code, sum]) => money(sum, code)).join(' · '), 'point-archive-total');
  const lists = new Map();
  const history = new Map();
  for (const row of rows) {
    const key = String(row.shk);
    if (!history.has(key)) history.set(key, []);
    history.get(key).push(row);
  }
  for (const row of operations) {
    const month = row.operation_date?.slice(0, 7) || '';
    if (!lists.has(month)) lists.set(month, element('ul', '', 'point-archive-list'));
    const item = element('li', '', 'point-archive-row');
    item.append(renderOperation(row, history.get(String(row.shk))));
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
 const defaultPanel = new URLSearchParams(location.search).get('tab') === 'tickets' ? 'tickets' : 'disputes';
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
      const pointFilter = 'wb_point_id=eq.' + encodeURIComponent(pointId);
      const archiveQuery = 'edpvz_owner_stuck_history?' + pointFilter
        + '&select=operation_type,shk,amount,currency,operation_date,operation_time,cell,return_box,accept_box,paid'
        + '&order=operation_date.desc,operation_time.desc,source_row.desc';
      const liveQuery = 'edpvz_dispute_observations?' + pointFilter
        + '&select=wb_state,barcode,amount,raw&wb_state=in.(paid,withheld)&is_current=eq.true&order=id.asc';
      async function readAll(query) {
        const all = [];
        for (let offset = 0; offset < 100000; offset += 1000) {
          const page = await account.readTable(query + '&limit=1000&offset=' + offset);
          all.push(...page);
          if (page.length < 1000) return all;
        }
        throw Error('Превышен лимит истории');
      }
      const request = archive.get(pointId) ?? Promise.all([readAll(archiveQuery), readAll(liveQuery)]).then(([history, live]) => {
        const known = new Map(history.map(row => [row.operation_type + '|' + operationKey(row), row]));
        const additions = [];
        for (const row of live) {
          const operation = { operation_type: row.wb_state === 'paid' ? 'Доплачено' : 'Удержано',
            shk: row.barcode, amount: row.amount, currency: 'RUB', ticket_number: row.raw?.ticket_number, product_url: row.raw?.product_url, movement: row.raw?.movement };
          const existing = known.get(operation.operation_type + '|' + operationKey(operation));
          if (existing) {
            existing.ticket_number ||= operation.ticket_number;
            existing.product_url ||= operation.product_url;
            existing.movement ||= operation.movement;
          }
          else additions.push(operation);
        }
        return [...history, ...additions];
      });
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
    active: point => selected.get(pointKey(point)) ?? defaultPanel,
    hydrate,
    clear() {
      selected.clear();
      archive.clear();
    }
  };
}
