import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';import{resolve}from'node:path';import{createHash}from'node:crypto';import{chromium}from'playwright';
const root=process.env.CARDS_FIXTURE_DIR,owner='0f75065b-2b26-4a87-bf26-005f5a2284d4',id='10000000-0000-4000-8000-000000000001',photo='https://basket-1.wbbasket.ru/test.webp',asset='assets/wb-disputes/'+createHash('sha256').update(photo).digest('hex')+'.webp';let manualRows=[],removedOwner=false,authorized=true,notes=[],amount='2589.00',calls=0,currentId=id;
if(!root)throw Error('CARDS_FIXTURE_DIR required');const browser=await chromium.launch({headless:true,...(process.env.CARDS_BROWSER_EXECUTABLE?{executablePath:process.env.CARDS_BROWSER_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.route('https://edholod.github.io/**',async route=>{const path=new URL(route.request().url()).pathname;if(path.endsWith('/assets/account.js'))return route.fulfill({contentType:'text/javascript',body:`window.EdPVZAccount={signedIn:${authorized},user:{id:'${owner}'},ensure:async()=>({access_token:'synthetic'}),rpc:async(name,args)=>{if(name!=='edpvz_dispute_manage_access'||args.p_org!=='org01')throw Error('Unexpected invitation scope');if(args.p_action==='issue'){if(args.p_username!=='fixture_owner')throw Error('Unexpected username');return {state:'pending',username:args.p_username,expires_at:'2026-11-18T00:00:00Z',code:'PVZ-0123456789ABCDEF0123456789ABCDEF'}}return {state:'none'}}};`});const file=path.split('/apps/disputes/')[1]||'index.html';if(file.includes('..'))throw Error('Unsafe path');return route.fulfill({contentType:file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'text/javascript',body:await readFile(resolve(root,file))})});
 await page.route('https://raw.githubusercontent.com/**',r=>r.fulfill({contentType:r.request().url().includes('index.json')?'application/json':'image/svg+xml',body:r.request().url().includes('index.json')?JSON.stringify([asset]):'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="100"/>'}));
 await page.route('https://duerixyhzapotoeclggz.supabase.co/**',async route=>{calls++;const r=route.request(),table=new URL(r.url()).pathname.split('/').pop();let data=[];
 if(table==='edpvz_dispute_organizations')data=[{research_id:'org01',name_exact:'ИП Тест'}];
 if(table==='edpvz_dispute_points')data=[{wb_point_id:'500001',organization_research_id:'org01',address_observed:'Москва, Тестовая 1'}];
 if(table==='edpvz_dispute_observations')data=[{id:currentId,organization_research_id:'org01',wb_point_id:'500001',wb_state:'to-hold',is_current:true,barcode:'59038506501',amount,category:'Зависший',title:'Товар WB',photo_url:photo,raw:{collection_since:'2026-10-01',date_label:'до 10.11.2026, 12:00',ticket_number:'777'}}];
 if(table==='edpvz_dispute_observations'){
  if(r.method()==='POST'){
   const row=JSON.parse(r.postData());
   assert.equal(row.source_namespace,'manual:v1');
   assert.equal(row.organization_research_id,'org01');
   assert.equal(row.wb_point_id,'500001');
   assert.equal(row.category,'Зависший');
   manualRows.push(row);data=[row];
  }else data.push(...manualRows);
 }
 if(table==='edpvz_dispute_notes'){if(r.method()==='POST')notes=[{...JSON.parse(r.postData()),revision:0}];else if(r.method()==='PATCH'){assert.equal(new URL(r.url()).searchParams.get('observation_id'),'eq.'+id);notes=[{...notes[0],...JSON.parse(r.postData()),revision:notes[0].revision+1}]}data=notes.map(n=>({...n,source:{organization_research_id:'org01',wb_point_id:'500001',category:'Зависший',barcode:'59038506501',raw:{}}}))}
 if(table==='edpvz_dispute_tickets'){assert.equal(new URL(r.url()).searchParams.get('ticket_number'),'in.(777)');data=[{ticket_number:'777',organization_research_id:'org01',wb_point_id:'500001',status:'В работе',last_checked_at:'2026-11-10T09:00:00Z'}]}
 if(removedOwner&&['edpvz_dispute_organizations','edpvz_dispute_points','edpvz_dispute_observations','edpvz_dispute_notes'].includes(table))data=[];
 if(table==='edpvz_dispute_sync_control')data=[{last_state:'ok',last_report:{}}];
 return route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,PATCH,OPTIONS'},body:JSON.stringify(r.method()==='OPTIONS'?{}:data)});
 });
 const enter=async()=>{await page.getByRole('button',{name:/ИП Тест/}).click();await page.locator('.point[open]').waitFor();assert.equal(await page.locator('.card-editor').getAttribute('open'),null);assert.ok(await page.locator('.case').evaluate(el=>el.getBoundingClientRect().height<280));await page.locator('.card-editor>summary').click()};
 await page.goto('https://edholod.github.io/ed-pvz/apps/disputes/');await enter();await page.getByText('WB: обращение № 777 · В работе',{exact:false}).waitFor();assert.equal(await page.locator('[name=ticket_number]').inputValue(),'');
 await page.locator('#owner-invite summary').click();
 await page.getByLabel('Логин собственника в Эд ПВЗ').fill('fixture_owner');
 await page.getByRole('button',{name:'Создать код',exact:true}).click();
 await page.locator('#invite-code').waitFor();
 assert.equal(await page.locator('#invite-code').inputValue(),'PVZ-0123456789ABCDEF0123456789ABCDEF');
 page.once('dialog',dialog=>dialog.accept());
 await page.getByRole('button',{name:'Отменить код',exact:true}).click();
 await page.locator('#invite-code').waitFor({state:'hidden'});
 await page.locator('#owner-invite summary').click();
 assert.equal(await page.locator('[name=sticker]').inputValue(),'59038506501');assert.equal(await page.locator('.case-form [name=cost]').inputValue(),'2589.00');assert.equal(await page.locator('[name=withholding_date]').inputValue(),'2026-11-10');assert.equal(await page.locator('[name=comment]').inputValue(),'');
 for(const [label,color] of [['Обращение не создано','rgb(255, 255, 255)'],['Тикет в работе','rgb(249, 237, 200)'],['Оспаривание отклонено по тех. причинам','rgb(247, 214, 221)'],['Вина сотрудника','rgb(211, 229, 248)'],['Успешно оспорено','rgb(214, 237, 220)']]){await page.locator('[name=status]').selectOption({label});assert.equal(await page.locator('.case').evaluate(el=>getComputedStyle(el).backgroundColor),color)}
 await page.locator('[name=status]').selectOption({label:'Вина сотрудника'});await page.locator('[name=employee_fault]').fill('Тестовый сотрудник');await page.locator('[name=comment]').fill('Мой комментарий');await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByText('Сохранено',{exact:true}).waitFor();
 assert.equal(await page.locator('.case').evaluate(el=>getComputedStyle(el).borderTopColor),'rgb(185, 212, 238)');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 amount='9999.00';currentId='10000000-0000-4000-8000-000000000002';await page.reload();await enter();assert.equal(await page.locator('.case-form [name=cost]').inputValue(),'2589.00');assert.equal(await page.locator('[name=comment]').inputValue(),'Мой комментарий');assert.equal(await page.locator('[name=employee_fault]').inputValue(),'Тестовый сотрудник');
 await page.locator('[name=status]').selectOption({label:'Успешно оспорено'});await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByText('Сохранено',{exact:true}).waitFor();assert.equal(notes[0].status,'Успешно оспорено');
 await page.locator('#manual-hanging summary').click();
 const manual=page.locator('#manual-hanging-form');
 await manual.getByLabel('ШК / стикер').fill('123456789');
 await manual.getByLabel('Название товара').fill('Ручной зависший');
 await manual.getByLabel('Стоимость, ₽').fill('123,45');
 await manual.getByLabel('Создать обращение до').fill('2026-11-20');
 await manual.getByRole('button',{name:'Добавить товар'}).click();
 await page.getByText('Зависший товар добавлен.',{exact:true}).waitFor();
 await page.getByRole('heading',{name:'Ручной зависший',exact:true}).waitFor();
 assert.equal(manualRows.length,1);
 assert.equal(manualRows[0].amount,'123.45');
 assert.equal(manualRows[0].raw.date_label,'до 20.11.2026');
 await page.reload();
 await page.getByRole('button',{name:/ИП Тест/}).click();
 await page.getByRole('heading',{name:'Ручной зависший',exact:true}).waitFor();
 await page.locator('[data-case="'+currentId+'"] .card-editor>summary').click();
 await page.locator('[data-case="'+currentId+'"] [name=comment]').fill('Черновик удаляемого собственника');removedOwner=true;await page.evaluate(()=>window.dispatchEvent(new Event('edpvz-auth-changed')));await page.locator('[data-case="'+currentId+'"]').waitFor({state:'detached'});assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('edpvz-dispute-drafts-v1:0f75065b-2b26-4a87-bf26-005f5a2284d4')||'[]').length),0);
 authorized=false;calls=0;await page.reload();await page.getByText('Доступ только для владельца раздела. Войди в свой аккаунт Эд ПВЗ.',{exact:true}).waitFor();assert.equal(calls,0);
 console.log('Cards UI passed: auto fields, edits, persistence, pastel status, mobile width, private gate, code issue and cancellation, manual hanging item creation and reload.');
}finally{await browser.close()}
