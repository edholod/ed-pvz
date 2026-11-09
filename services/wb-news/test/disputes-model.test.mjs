import test from 'node:test';
import assert from 'node:assert/strict';
import {money,observationRows,normalizeMessages,appendedSupport,ticketNeedsDetail,safeImage,hasWBCookies} from '../disputes-model.mjs';
const scope={organization:'org01',point:'001234',category:'Зависший',state:'to-hold'};
test('WB session backup recognizes real WB domains and rejects lookalikes',()=>{
 for(const domain of ['my-pvz.wb.ru','.wb.ru','wildberries.ru'])assert.equal(hasWBCookies({cookies:[{domain}]}),true);
 assert.equal(hasWBCookies({cookies:[{domain:'evilwb.ru'}]}),false);
});
test('money preserves decimal precision and does not turn missing amounts into zero',()=>{
 assert.equal(money('23 867,21 ₽'),'23867.21');assert.equal(money(''),null);assert.equal(money('-5 000 ₽'),'-5000');
});
test('same barcode with different tickets remains distinct; identical repeated cards retain multiplicity',()=>{
 const items=[{barcode:'00123456789',ticketNumber:'1'},{barcode:'00123456789',ticketNumber:'2'},{barcode:'00123456789',ticketNumber:'2'}];
 const a=observationRows(items,scope),b=observationRows(items,scope);
 assert.equal(new Set(a.map(x=>x.source_event_id)).size,3);assert.deepEqual(a,b);assert.equal(a[0].barcode,'00123456789');assert.equal(a[0].identity_kind,'observed_card');
});
test('deadline is not a withholding date and photo URLs with auth parameters are rejected',()=>{
 const row=observationRows([{barcode:'123456789',dateLabel:'до 15.11.2026, 11:50',amount:'498'}],scope)[0];
 assert.equal(row.raw.amount_kind,'expected');assert.equal(row.withheld_at,undefined);assert.equal(safeImage('https://basket-1.wbbasket.ru/a.webp?token=x'),null);
});
test('baseline, edited messages and user replies do not generate new support alerts',()=>{
 const old=normalizeMessages([{role:'user',text:'case'},{role:'wb_support',text:'old'}]);
 assert.deepEqual(appendedSupport([],old),[]);
 assert.deepEqual(appendedSupport(old.map(x=>x.source_message_id),normalizeMessages([{role:'user',text:'case'},{role:'wb_support',text:'edited'}])),[]);
 const next=normalizeMessages([{role:'user',text:'case'},{role:'wb_support',text:'old'},{role:'user',text:'thanks'},{role:'wb_support',text:'new'}]);
 assert.equal(appendedSupport(old.map(x=>x.source_message_id),next).length,1);
});
test('repeated identical messages retain occurrence IDs; separate ticket caches are required',()=>{
 const rows=normalizeMessages([{role:'wb_support',text:'yes'},{role:'wb_support',text:'yes'}]);assert.notEqual(rows[0].source_message_id,rows[1].source_message_id);
 assert.equal(ticketNeedsDetail({status:'В работе'},{baseline_completed_at:'2026-11-09',last_checked_at:new Date().toISOString()}),true);
});
