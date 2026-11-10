import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {scanVirtual,chooseTicketPoint,releaseBrowserMemory,waitGoodsDrawer,extractGoods,extractPointGroups,extractTicketRows,extractMessages,pageReady,extractHangingGroupLabels,expandVisibleReasons,readGoodsScopeProof,confirmsAbsentPoints} from '../disputes-browser.mjs';
test('missing groups confirm zero only with a complete unfiltered list, matching WB total and correct owner',()=>{
 const {document}=parseHTML('<main><header data-testid="app-header">ИП Тест</header><div aria-expanded="false">Адрес или ID ПВЗ</div><div>Период</div><div>2 ПВЗ</div><input value=""></main>');
 const root=document.querySelector('main'),proof=readGoodsScopeProof(root),org={name_exact:'ИП Тест',points:[{wb_point_id:'111111'},{wb_point_id:'222222'},{wb_point_id:'333333'}]},scan={complete:true,rows:[{point:'111111'},{point:'222222'}]};
 assert.equal(confirmsAbsentPoints(proof,scan,org),true);
 assert.equal(confirmsAbsentPoints({...proof,declaredPoints:3},scan,org),false);
 assert.equal(confirmsAbsentPoints(proof,{...scan,complete:false},org),false);
 assert.equal(confirmsAbsentPoints({...proof,header:'ИП Другой'},scan,org),false);
 assert.equal(confirmsAbsentPoints(proof,{complete:true,rows:[{point:'999999'},{point:'222222'}]},org),false);
 root.querySelector('input').value='10.11.2026';assert.equal(confirmsAbsentPoints(readGoodsScopeProof(root),scan,org),false);
});
test('reason expansion skips hidden controls and stops after a failed or unchanged click',async()=>{
 let clicks=0;const nodes=[{visible:false},{visible:true}];
 const root={getByText:()=>({count:async()=>nodes.length,nth:i=>({isVisible:async()=>nodes[i].visible,click:async options=>{assert.equal(options.timeout,2000);clicks++;nodes.splice(i,1)}})})};
 assert.equal(await expandVisibleReasons(root),true);assert.equal(clicks,1);
 const unchanged={getByText:()=>({count:async()=>1,nth:()=>({isVisible:async()=>true,click:async()=>{clicks++}})})};
 assert.equal(await expandVisibleReasons(unchanged),false);assert.equal(clicks,2);
});
test('hanging groups are read from div/span labels as well as paragraph markup',()=>{
 const {document}=parseHTML('<main><div><span>Товары из ПВЗ</span></div><button><span>№ 001234</span></button><p>Не группа</p><div>№ 001234</div></main>');
 assert.deepEqual(extractHangingGroupLabels(document.querySelector('main')),['Товары из ПВЗ','№ 001234']);
});
test('WB section title rendered without h1/h2 is accepted while login redirects remain rejected',async()=>{
 let info={url:'https://my-pvz.wb.ru/defects/to-hold',text:'Меню\nБрак\nТоваров 1',headings:[]};
 const page={waitForFunction:async()=>{},evaluate:async()=>info};
 assert.equal(await pageReady(page,'Брак'),info);
 info={url:'https://my-pvz.wb.ru/login',text:'Отправить код',headings:[]};
 await assert.rejects(pageReady(page,'Брак'),error=>error.code==='authentication_required');
});
test('goods extraction binds each barcode to its own photo, amount, ticket and date',()=>{
 const {document}=parseHTML('<main><div data-index="0"><article><img alt="Первый товар" src="https://basket-1.wbbasket.ru/first.webp"><button>ШК 0000123456789</button><div>Первый товар</div><div>Другой предмет</div><button>В тикет</button><button>№ 20529613</button><div>540.5 ₽</div><div>до 27.09.2026, 21:22</div></article></div><div data-index="1"><article><img alt="Второй товар" src="https://basket-1.wbbasket.ru/second.webp"><button>ШК 0000123456789</button><div>Второй товар</div><div>Пыль/грязь</div><button>В тикет</button><button>№ 20529614</button><div>498 ₽</div></article></div></main>');
 const rows=extractGoods(document.querySelector('main'));
 assert.equal(rows.length,2);assert.equal(rows[0].ticketNumber,'20529613');assert.equal(rows[1].amount,'498 ₽');assert.match(rows[0].photo,/first/);assert.equal(rows[0].eventId,null);assert.equal(rows[1].position,'1');
});
test('deadline in sibling footer belongs only to its product, not an adjacent row or a comment',()=>{
 const {document}=parseHTML('<main><div data-index="0"><article><img alt="Товар" src="https://basket-1.wbbasket.ru/a.webp"><button>ШК 12345678</button><div>100 ₽</div></article><footer>Оспорить до 20.11.2026, 12:30</footer></div><div data-index="1"><article><img src="https://basket-1.wbbasket.ru/b.webp"><button>ШК 87654321</button><div>200 ₽</div><p>Сотрудник обещал до 21.11.2026</p></article></div><div>до 30.11.2026</div></main>');
 const rows=extractGoods(document.querySelector('main'));
 assert.equal(rows[0].dateLabel,'до 20.11.2026, 12:30');assert.equal(rows[0].amount,'100 ₽');assert.equal(rows[1].dateLabel,'');
});
test('point groups retain explicit zero counts and address bindings',()=>{
 const {document}=parseHTML('<main><article><p>ID 0001234</p><p>Адрес один</p><div>Товаров0</div><div>0 ₽</div></article><article><p>ID 0005678</p><p>Адрес два</p><div>Товаров4</div><div>500 ₽</div></article></main>');
 assert.deepEqual(extractPointGroups(document.querySelector('main')).map(x=>[x.point,x.count]),[['0001234',0],['0005678',4]]);
});
test('ticket list extraction preserves string numbers and actual PVZ',()=>{
 const {document}=parseHTML('<main><article><div>В работе</div><div>Зависшие шк</div><button>№ 000172253</button><div>ID 137168</div><div>30.10.2026</div><div>12:23</div></article></main>');
 const [row]=extractTicketRows(document.querySelector('main'));assert.equal(row.number,'000172253');assert.equal(row.point,'137168');assert.equal(row.status,'В работе');
});
test('support author outside the message bubble and date separators are retained',()=>{
 const {document,Node}=parseHTML('<main><strong>30 октября 2026 г.</strong><div><span>Ммм Саша</span><div><p>Моё сообщение</p><sub>12:34</sub></div></div><strong>2 ноября 2026 г.</strong><div><span>Менеджер</span><div><p>Новый ответ WB</p><a href="https://example.com/video">Видео</a><sub>11:21</sub></div></div></main>');
 const before=globalThis.Node;globalThis.Node=Node;
 try{const rows=extractMessages(document.querySelector('main'));assert.equal(rows.length,2);assert.equal(rows[1].role,'wb_support');assert.equal(rows[1].author,'Менеджер');assert.equal(rows[1].dateLocal,'02.11.2026 11:21');assert.equal(rows[0].role,'unknown');}
 finally{globalThis.Node=before}
});

test('a visible goods drawer is not ready until its asynchronously loaded content arrives',async()=>{
 const previous=globalThis.document;
 try{
  let ready;const {document}=parseHTML('<main><div role="dialog">ID 50136835</div></main>');globalThis.document=document;
  const page={waitForFunction:async(predicate,args,options)=>{ready=predicate(args);assert.equal(options.timeout,25000)}};
  await waitGoodsDrawer(page,{groups:true});assert.equal(ready,false);
  document.querySelector('[role="dialog"]').innerHTML='<div>Товары из ПВЗ</div>';
  await waitGoodsDrawer(page,{groups:true});assert.equal(ready,true);
  await waitGoodsDrawer(page);assert.equal(ready,false);
  document.querySelector('[role="dialog"]').innerHTML='<button>ШК 123456789</button>';
  await waitGoodsDrawer(page);assert.equal(ready,true);
 }finally{globalThis.document=previous}
});

test('memory housekeeping releases its CDP handle and never changes browser storage',async()=>{
 const calls=[];const session={send:async(method,args)=>calls.push([method,args]),detach:async()=>calls.push('detached')};
 await releaseBrowserMemory({context:()=>({newCDPSession:async()=>session})});
 assert.deepEqual(calls,[['Memory.simulatePressureNotification',{level:'critical'}],'detached']);
 calls.length=0;session.send=async()=>{throw Error('unsupported')};await releaseBrowserMemory({context:()=>({newCDPSession:async()=>session})});assert.deepEqual(calls,['detached']);
 await releaseBrowserMemory({context:()=>({newCDPSession:async()=>{throw Error('browser unavailable')}})});
});

test('the new ticket multiselect resets previous points and closes before scanning rows',async()=>{
 let expanded=false;const calls=[];
 const multi={count:async()=>1,getAttribute:async()=>String(expanded),click:async()=>{expanded=!expanded;calls.push('toggle')}};
 const reset={count:async()=>1,isVisible:async()=>true,isEnabled:async()=>true,click:async()=>calls.push('reset')};
 const page={waitForFunction:async()=>{},keyboard:{press:async key=>{assert.equal(key,'Escape');expanded=false;calls.push('escape')}},getByTestId:id=>id==='new-tickets-point-multiselect'?multi:reset,getByText:(text,options)=>{assert.equal(text,'ID 50136835');assert.equal(options.exact,true);return {last:()=>({click:async()=>calls.push('point')})}}};
 await chooseTicketPoint(page,'50136835');assert.equal(expanded,false);assert.deepEqual(calls,['toggle','reset','point','escape']);
});

test('a virtual scroller which cannot advance stops without claiming the list is complete',async()=>{
 let reads=0;const scroller={count:async()=>1,evaluate:async fn=>fn.toString().includes('clientHeight')&&fn.toString().includes('top:')?{top:0,height:100,total:1000}:undefined};
 const root={getByTestId:()=>({filter:options=>{assert.equal(options.visible,true);return {last:()=>scroller}}}),evaluate:async()=>{reads++;return [{point:'50136835'}]}};
 const result=await scanVirtual({},root,()=>[],{maxWindows:150});assert.equal(result.complete,false);assert.equal(result.reason,'stalled_scroller');assert.equal(result.rows.length,1);assert.ok(reads<=6);
});
test('new ticket filters skip disabled reset and close with an outside heading when Escape is ignored',async()=>{
 let expanded=false;const calls=[];
 const multi={count:async()=>1,getAttribute:async()=>String(expanded),click:async()=>{expanded=!expanded;calls.push('toggle')}};
 const reset={count:async()=>1,isVisible:async()=>true,isEnabled:async()=>false,click:async()=>{throw Error('disabled reset must not be clicked')}};
 const page={waitForFunction:async()=>{},keyboard:{press:async()=>calls.push('escape')},getByTestId:id=>id==='new-tickets-point-multiselect'?multi:reset,getByText:()=>({last:()=>({click:async()=>calls.push('point')})}),getByRole:(role,options)=>{assert.equal(role,'heading');assert.equal(options.name,'Тикеты');return {click:async()=>{expanded=false;calls.push('outside')}}}};
 await chooseTicketPoint(page,'50136835');assert.equal(expanded,false);assert.deepEqual(calls,['toggle','point','escape','outside']);
});
test('range selection supports the single WB date input and verifies both boundaries',async()=>{
 const {selectCollectionPeriod}=await import('../disputes-browser.mjs');let value='',applied=false;
 const input={evaluate:async()=>({type:'text',value,readOnly:false,placeholder:''}),fill:async text=>value=text,press:async()=>{},inputValue:async()=>value,getAttribute:async()=>null};
 const inputs={evaluateAll:async()=>value,filter(){return this},count:async()=>1,nth:()=>input};
 const trigger={first(){return this},count:async()=>1,click:async()=>{}};
 const page={locator:()=>inputs,getByText:()=>trigger,getByRole:()=>({click:async()=>applied=true}),waitForLoadState:async()=>{},keyboard:{press:async()=>{}}};
 const result=await selectCollectionPeriod(page,'Зависшие ШК');assert.equal(result.verified,true);assert.equal(result.start,'2026-10-01');assert.equal(applied,true);assert.match(value,/01\.10\.2026 - /);
});
test('calendar selection resolves the requested month rather than the same day in the adjacent month',async()=>{
 const {calendarDayIndex}=await import('../disputes-browser.mjs');const{document}=parseHTML('<main><section><h3>Октябрь 2026</h3><button id="oct">1</button></section><section><h3>Ноябрь 2026</h3><button id="nov">1</button></section></main>');
 for(const e of document.querySelectorAll('*'))e.getClientRects=()=>[{}];const root=document.querySelector('main'),index=calendarDayIndex(root,{day:1,month:9,year:2026});assert.equal(root.querySelectorAll('button,[role="button"],[role="gridcell"],td,span')[index].id,'oct');
});
