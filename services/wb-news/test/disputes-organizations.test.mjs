import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {normalizeOrganization,organizationLabelMatches,organizationPattern,readOrganizationEvidence,verifyOrganization,selectOrganization} from '../disputes-organizations.mjs';
test('organization names handle line breaks, NBSP, quotes and role badges without matching a different entity',()=>{
 assert.equal(normalizeOrganization('  ООО «НПЦ МОНО»\n\t'),'ооо нпц моно');
 assert.ok(organizationPattern('ООО "НПЦ МОНО"').test('ООО\u00a0«НПЦ МОНО»'));
 assert.ok(organizationLabelMatches('ИП Айрапетян Роберт Юрикович\nУправляющий','ИП Айрапетян Роберт Юрикович'));
 assert.ok(organizationLabelMatches('ООО «НПЦ МОНО» Управляющий','ООО "НПЦ МОНО"'));
 assert.equal(organizationLabelMatches('ООО «НПЦ МОНО 2»','ООО "НПЦ МОНО"'),false);
});
test('checked radio evidence uses the enclosing label rather than empty input text',()=>{
 const {document}=parseHTML('<body><header data-testid="app-header">ПВЗ</header><label><input type="radio" checked><span>ИП Айрапетян Роберт Юрикович</span><span>Управляющий</span></label></body>');
 const input=document.querySelector('input');
 // linkedom does not implement :checked for input; preserve the browser selector semantics in this fixture.
 const original=document.querySelectorAll.bind(document);document.querySelectorAll=selector=>selector.startsWith('input:checked')?[input]:original(selector);
 const evidence=readOrganizationEvidence(document);
 assert.equal(input.textContent,'');assert.match(evidence.selected[0],/Айрапетян/);
 assert.ok(verifyOrganization(evidence,'ИП Айрапетян Роберт Юрикович'));
});
test('active registered PVZ proves the organization when legal name is omitted; mixed and unselected groups fail closed',()=>{
 const context={pointIds:['123456'],allPointIds:['123456','654321']};
 const base={header:'ПВЗ Седова',selected:[],pointIds:['123456'],options:[]};
 assert.ok(verifyOrganization(base,'ИП Тест',context));
 assert.equal(verifyOrganization({...base,pointIds:['654321']},'ИП Тест',context),false);
 assert.equal(verifyOrganization({...base,pointIds:['123456','654321']},'ИП Тест',context),false);
 assert.equal(verifyOrganization({...base,options:['ИП Другая']},'ИП Тест',context),false);
});
test('expired login aborts organization switching before any click or organization retry',async()=>{
 let clicked=false;const page={url:()=> 'https://my-pvz.wb.ru/login',locator:()=>({innerText:async()=> 'Отправить код',click:async()=>clicked=true})};
 await assert.rejects(selectOrganization(page,'ИП Тест'),error=>error.code==='authentication_required');assert.equal(clicked,false);
});
