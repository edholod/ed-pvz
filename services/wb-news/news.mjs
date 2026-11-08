import {createHash} from 'node:crypto';

export const SECTIONS = ['owners', 'employees'];
export const WB_ORIGIN = 'https://my-pvz.wb.ru';
const MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];

export function parseDate(text) {
  const m = String(text).match(/^(\d{1,2})\s+([а-я]+)\s+(\d{4})\s+г\.\s+в\s+(\d{1,2}):(\d{2})$/i);
  if (!m || !MONTHS.includes(m[2].toLowerCase())) return null;
  const [, day, month, year, hour, minute] = m;
  const index = MONTHS.indexOf(month.toLowerCase());
  const date = new Date(Date.UTC(+year, index, +day, +hour - 3, +minute));
  const local = new Date(date.getTime() + 3 * 3600000);
  if (local.getUTCFullYear() !== +year || local.getUTCMonth() !== index || local.getUTCDate() !== +day || +hour > 23 || +minute > 59) return null;
  return date.toISOString();
}

export function safeURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

// Runs only inside the visible news DOM. Never reads storage, cookies or account header.
export function extractCards() {
  const datePattern = /^\d{1,2}\s+[а-я]+\s+\d{4}\s+г\.\s+в\s+\d{1,2}:\d{2}$/i;
  const result = [];
  for (const heading of document.querySelectorAll('h1')) {
    let card = heading.parentElement;
    let dateNode;
    for (let depth = 0; card && depth < 8; depth++, card = card.parentElement) {
      if (card.querySelectorAll('h1').length !== 1) break;
      dateNode = Array.from(card.querySelectorAll('div,span,time')).find(el => el.children.length === 0 && datePattern.test(el.textContent.trim()));
      if (dateNode) break;
    }
    if (!dateNode || !card || card.querySelectorAll('h1').length !== 1) continue;
    const titleBlock = heading.parentElement?.parentElement;
    const body = titleBlock?.nextElementSibling;
    if (!body || !card.contains(body) || body.contains(dateNode)) continue;
    result.push({
      title: heading.textContent.trim(),
      content: body.innerText.trim(),
      dateText: dateNode.textContent.trim(),
      links: Array.from(body.querySelectorAll('a[href]')).map(a => ({text: a.textContent.trim(), url: a.href})),
      image: card.querySelector('img[alt="news image"]')?.src || '',
    });
  }
  return result;
}

export function normalizeCards(cards, section) {
  if (!SECTIONS.includes(section)) throw new Error('Unknown section');
  return cards.flatMap(card => {
    const date = parseDate(card.dateText);
    if (!date || !card.title?.trim() || !card.content?.trim()) return [];
    const title = card.title.trim().slice(0, 500);
    const content = card.content.trim().slice(0, 100000);
    const id = createHash('sha256').update(`${title}\n${date}`).digest('hex').slice(0, 24);
    return [{id: `wb-pvz-${id}`, title, content, date,
      url: `${WB_ORIGIN}/news/${section}#ed-news-${id}`,
      source: 'WB Мой ПВЗ', category: 'Мой ПВЗ', audience: [section],
      links: (card.links || []).map(link => ({text: String(link.text || '').slice(0, 500), url: safeURL(link.url)})).filter(link => link.url),
      image: safeURL(card.image), origin: 'my-pvz',
    }];
  });
}

export function mergeNews(previous, incoming) {
  const entries = new Map(previous.map(item => [item.id, item]));
  for (const item of incoming) {
    const old = entries.get(item.id);
    entries.set(item.id, {...item, audience: [...new Set([...(old?.audience || []), ...item.audience])]});
  }
  return [...entries.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 500);
}
