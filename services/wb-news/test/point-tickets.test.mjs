import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHTML } from 'linkedom';
import { groupPointTickets, renderPointTickets, renderUrgentTickets, replyCountdown } from '../../../apps/disputes/point-tickets.mjs';

const point = { organization_research_id: 'org1', wb_point_id: '001' };
const ticket = (number, title, created_local, fields = {}) => ({
 ...point, ticket_number: number, title, created_local, status: 'В работе', namespace: 'legacy', ...fields
});
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

test('tickets stay with their organization and point, and both WB lists keep distinct IDs', () => {
 const rows = [
  ticket('0', 'Старое обращение', '30.09.2026'),
  ticket('5', 'Тикет с первого октября', '01.10.2026'),
  ticket('1', 'Оспаривание брака', '31.10.2026'),
  ticket('1', 'График работы ПВЗ', '01.11.2026', { namespace: 'new' }),
  ticket('2', 'Зависшие ШК', '02.11.2026'),
  ticket('3', 'Вопрос к менеджеру', '03.11.2026'),
  ticket('3', 'Вопрос к менеджеру', '03.11.2026', { organization_research_id: 'org2' }),
  ticket('4', 'Оспаривание подмен', '04.11.2026', { wb_point_id: '002' })
 ];
 const groups = groupPointTickets(rows, [{ ...point, raw: { ticket_number: '3' } }]);
 const { document } = parseHTML(renderPointTickets(point, groups, [], false, 'other', escape));
 assert.equal(document.querySelector('[data-ticket-panel="withholding"]').hidden, true);
 assert.equal(document.querySelector('[data-ticket-panel="other"]').hidden, false);
 assert.deepEqual([...document.querySelectorAll('[data-ticket-panel="withholding"] [data-open-ticket]')].map(node => node.textContent),
  ['Вопрос к менеджеру', 'Зависшие ШК', 'Оспаривание брака']);
 assert.deepEqual([...document.querySelectorAll('[data-ticket-panel="other"] [data-open-ticket]')].map(node => node.textContent),
  ['График работы ПВЗ', 'Тикет с первого октября']);
 assert.equal(document.querySelector('[data-ticket-tab="other"]').getAttribute('aria-pressed'), 'true');
});

test('old checks and failed requests are visible, and WB topics are escaped', () => {
 const groups = groupPointTickets([ticket('7', '<img src=bad>', '08.11.2026', { status: 'Новый' })], []);
 const scopes = ['legacy', 'new'].map(namespace => ({
  scope: `wb:org1:001:tickets:${namespace}`, state: 'ok', last_success: '2020-01-01T12:00:00Z'
 }));
 const html = renderPointTickets(point, groups, scopes, false, 'other', escape);
 const { document } = parseHTML(html);
 assert.equal(document.querySelector('img'), null);
 assert.equal(document.querySelector('[data-open-ticket]').textContent, '<img src=bad>');
 assert.match(html, /Данные могут быть устаревшими/);
 assert.match(renderPointTickets(point, groups, scopes, true, 'other', escape), /Не удалось обновить тикеты/);
});


test('reply timer handles time remaining, expired deadlines and missing WB timestamps', () => {
 const start = Date.parse('2026-11-16T00:00:00Z');
 assert.equal(replyCountdown('2026-11-19T00:00:00Z', start), 'Осталось 72 ч 0 мин');
 assert.equal(replyCountdown('2026-11-16T00:00:30Z', start), 'Осталось 1 мин');
 assert.equal(replyCountdown('2026-11-16T00:00:00Z', start), '72 часа истекли');
 assert.match(replyCountdown('', start), /Срок неизвестен/);
});

test('urgent tickets are scoped to visible points and ordered by deadline', () => {
 const rows = [
  ticket('3', 'Позже', '13.11.2026', {reply_state:'needs_reply', reply_due_at:'2026-11-18T01:00:00Z'}),
  ticket('2', 'Раньше', '13.11.2026', {reply_state:'needs_reply', reply_due_at:'2026-11-17T01:00:00Z'}),
  ticket('1', 'Отвечено', '13.11.2026', {reply_state:'answered'}),
  ticket('4', 'Другой ПВЗ', '13.11.2026', {wb_point_id:'009',reply_state:'needs_reply'})
 ];
 const groups = groupPointTickets(rows, []);
 const { document } = parseHTML(renderUrgentTickets(groups, [point], escape, false));
 assert.deepEqual([...document.querySelectorAll('[data-open-ticket]')].map(item => item.textContent), ['Раньше','Позже']);
 assert.equal(document.querySelectorAll('[data-reply-due]').length, 2);
 assert.match(renderPointTickets(point, groups, [], false, 'other', escape), /Мы ответили · ждём WB/);
});

test('resolved tickets appear only in the archive and never show a running timer',()=>{
 const groups = groupPointTickets([
  ticket('1', 'Закрытое обращение', '22.11.2026', { status: 'Решен досрочно', reply_state: 'needs_reply' }),
  ticket('2', 'Мой ответ', '23.11.2026', { reply_state: 'answered' })
 ], []);
 const { document } = parseHTML(renderPointTickets(point, groups, [], false, 'other', escape));
 assert.match(document.querySelector('.resolved-tickets').textContent, /Закрытое обращение/);
 assert.doesNotMatch(document.querySelector('[data-ticket-panel="other"]').textContent, /Закрытое обращение/);
 assert.match(document.querySelector('[data-ticket-panel="other"]').textContent, /Мы ответили · ждём WB/);
 assert.equal(document.querySelector('[data-reply-due]'), null);
});
