import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyWBPage,normalizeDisputeRows} from '../disputes-inspector.mjs';
test('WB login and blocks never count as a readable page',()=>{
 assert.equal(classifyWBPage({url:'https://my-pvz.wb.ru/login'}),'authentication_required');
 assert.equal(classifyWBPage({url:'https://elsewhere.example/'}),'outside_wb');
 assert.equal(classifyWBPage({url:'https://my-pvz.wb.ru/tickets',bodyText:'Checking your browser',headings:['Тикеты']}),'blocked');
 assert.equal(classifyWBPage({url:'https://my-pvz.wb.ru/tickets',headings:[]}), 'unverified_layout');
});
test('Only unambiguous IDs and point IDs are accepted; repeated IDs are deduplicated',()=>{
 const section={key:'brak',category:'Брак'};
 const rows=[{eventId:'A-1',barcode:'123',amount:120},{eventId:'A-1',amount:200},{barcode:'555'},{eventId:'A-2',amount:'not a number'}];
 const output=normalizeDisputeRows(rows,section,'50088145');
 assert.equal(output.length,2);
 assert.equal(output[0].amount,120);
 assert.equal(output[1].amount,null);
 assert.equal(normalizeDisputeRows(rows,section,'unknown').length,0);
});
