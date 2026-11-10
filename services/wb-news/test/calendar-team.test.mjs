import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../../apps/control/team-model.js',import.meta.url),'utf8');
const context={window:{}};vm.runInNewContext(source,context);const {merge,load}=context.window.EdPVZCalendarTeam;
const uid='11111111-1111-4111-8111-111111111111';
const empty=()=>({points:[],people:[],shifts:[],payments:[],settings:{mode:'standard'}});
const team=()=>({points:[{point_id:'5000',name:'Тестовый'}],members:[{point_id:'5000',user_id:uid,status:'approved'}],cards:[],profiles:[{user_id:uid,username:'employee',role:'employee'}]});
test('approved employee without a staff card is available on their cloud point',()=>{
 const x=merge(empty(),team());assert.equal(x.points.length,1);assert.equal(x.people[0].name,'employee');assert.equal(x.people[0].points[0],x.points[0].id);assert.equal(x.people[0].archived,false);
});
test('refresh is idempotent and preserves shifts, salary rates, manual point and archive',()=>{
 const first=merge(empty(),team());first.people[0].rate=2200;first.people[0].hourlyRate=100;first.people[0].archived=true;first.people[0].points.push('manual');first.shifts.push({id:'shift',person:first.people[0].id,point:first.points[0].id,date:'2026-11-05'});
 const before=JSON.stringify(first),next=merge(first,team());assert.equal(JSON.stringify(first),before);assert.equal(JSON.stringify(next),before);assert.equal(next.people[0].rate,2200);
});
test('pending, rejected and unrelated point memberships do not create selectable staff',()=>{
 const t=team();t.members.push({point_id:'5000',user_id:'pending',status:'pending'},{point_id:'5000',user_id:'rejected',status:'rejected'},{point_id:'other',user_id:'stranger',status:'approved'});assert.equal(merge(empty(),t).people.length,1);
});
test('one person on two points remains one person; changed approval keeps historical data',()=>{
 const t=team();t.points.push({point_id:'5001',name:'Другой'});t.members.push({point_id:'5001',user_id:uid,status:'approved'});const first=merge(empty(),t);assert.equal(first.people.length,1);assert.equal(first.people[0].points.length,2);
 t.members=[];const next=merge(first,t);assert.equal(next.people[0].cloudInactive,true);assert.equal(next.people.length,1);
});
test('staff card name wins and supervisor maps to calendar manager',()=>{
 const t=team();t.cards.push({point_id:'5000',user_id:uid,full_name:'ФИО'});t.profiles[0].role='supervisor';const x=merge(empty(),t);assert.equal(x.people[0].name,'ФИО');assert.equal(x.people[0].role,'manager');
});
test('load rejects failed requests rather than replacing the team with empty arrays',async()=>{
 await assert.rejects(load({readTable:async path=>{if(path.startsWith('edpvz_memberships'))throw Error('offline');return []}}),/offline/);
});
test('calendar selectors exclude revoked cloud memberships',()=>{
 const app=readFileSync(new URL('../../../apps/control/app.js',import.meta.url),'utf8');assert.match(app,/function staffOptions\(\)[\s\S]*?filter\(x=>!x.archived&&!x.cloudInactive&&/);
});

test('calendar account workspaces retain legacy copy and do not import another account data',()=>{
 const app=readFileSync(new URL('../../../apps/control/app.js',import.meta.url),'utf8').split('let storageFault=')[0];
 const values=new Map([['pvz-control-v1','original calendar']]);
 const storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
 function boot(user){values.set('edpvz-auth-v1',JSON.stringify({access_token:'fixture',user:{id:user}}));return vm.runInNewContext(app+';({KEY,calendarAccountId})',{localStorage:storage})}
 const first=boot(uid);assert.equal(values.get(first.KEY),'original calendar');assert.equal(values.get('pvz-control-v1'),'original calendar');
 const second=boot('22222222-2222-4222-8222-222222222222');assert.notEqual(first.KEY,second.KEY);assert.equal(values.has(second.KEY),false);
});

test('an existing local point receives account staff without losing its original ID',()=>{
 const db=empty();db.points.push({id:'local-point',name:'Тестовый',market:'wb'});const result=merge(db,team());assert.equal(result.points.length,1);assert.equal(result.points[0].id,'local-point');assert.equal(result.people[0].points[0],'local-point');
});
test('legacy local point beside cloud copy also receives its confirmed team',()=>{
 const db=merge(empty(),team());db.points.push({id:'legacy',name:'Тестовый',market:'wb'});assert.ok(merge(db,team()).people[0].points.includes('legacy'));
});
test('marketplace is inherited for WB, Ozon and Yandex Market',()=>{
 for(const market of ['wb','ozon','ym']){const t=team();t.points[0].market=market;assert.equal(merge(empty(),t).points[0].market,market)}
});
