import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {extractGoods,extractPointGroups,extractTicketRows,extractMessages,pageReady,extractHangingGroupLabels,expandVisibleReasons} from '../disputes-browser.mjs';
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
