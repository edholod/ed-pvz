import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {normalizeCards, parseDate, mergeNews, safeURL} from '../news.mjs';
import {saveFeed, readFeed} from '../storage.mjs';
const card = {title:'Тестовое объявление',content:'Текст для теста',dateText:'8 ноября 2026 г. в 10:00',links:[]};
test('Moscow date converts to UTC; impossible dates rejected',()=>{
  assert.equal(parseDate(card.dateText),'2026-11-08T07:00:00.000Z');
  assert.equal(parseDate('31 февраля 2026 г. в 10:00'),null);
  assert.equal(parseDate('8 ноября 2026 г. в 29:00'),null);
});
test('only valid dated news cards survive; no account metadata is copied',()=>{
  const [item] = normalizeCards([{...card,account:'DO_NOT_COPY'}],'owners');
  assert.equal(item.account,undefined);assert.equal(item.source,'WB Мой ПВЗ');
  assert.equal(normalizeCards([{...card,dateText:'неизвестно'}],'owners').length,0);
  assert.throws(()=>normalizeCards([card],'settings'));
});
test('unsafe links and URL credentials are rejected',()=>{
  assert.equal(safeURL('javascript:alert(1)'),'');assert.equal(safeURL('https://user:secret@example.com'),'');
  assert.equal(safeURL('https://example.com/a'),'https://example.com/a');
});
test('same news in both sections merges audiences; text edits update the entry',()=>{
  const owners=normalizeCards([card],'owners'), employees=normalizeCards([{...card,content:'Исправленный текст'}],'employees');
  const items=mergeNews(owners,employees);
  assert.equal(items.length,1);assert.deepEqual(items[0].audience,['owners','employees']);
  assert.equal(items[0].content,'Исправленный текст');
});
test('previous news survives empty or partial updates',()=>{
  const previous=normalizeCards([card],'owners');assert.deepEqual(mergeNews(previous,[]),previous);
  assert.equal(mergeNews(previous,normalizeCards([{...card,title:'Другая новость'}],'employees')).length,2);
});
test('feed persists atomically and can be restored',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'ed-wb-'));
  try {const feed={updated:'test',items:normalizeCards([card],'owners')};await saveFeed(dir,feed);
    assert.deepEqual(await readFeed(dir),feed);assert.deepEqual(JSON.parse(await readFile(path.join(dir,'feed.json'),'utf8')),feed);
  } finally {await rm(dir,{recursive:true,force:true})}
});
