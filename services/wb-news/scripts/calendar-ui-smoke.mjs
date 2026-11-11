import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const server=createServer(async(req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://local').pathname);const resolved=path.resolve(root,'.'+name+(name.endsWith('/')?'index.html':''));if(!resolved.startsWith(root))throw Error();const data=await readFile(resolved);res.setHeader('Content-Type',resolved.endsWith('.html')?'text/html':(resolved.endsWith('.js')||resolved.endsWith('.mjs'))?'text/javascript':'application/octet-stream');res.end(data)}catch{res.writeHead(404).end()}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CARDS_BROWSER_EXECUTABLE||undefined,headless:true,args:['--no-sandbox']});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 const uid='11111111-1111-4111-8111-111111111111',staff='22222222-2222-4222-8222-222222222222';
 await context.addInitScript(({uid})=>{if(!sessionStorage.getItem('fixture-auth')){localStorage.setItem('edpvz-auth-v1',JSON.stringify({access_token:'synthetic-test-token',expires_at:9999999999,user:{id:uid}}));sessionStorage.setItem('fixture-auth','1')}},{uid});
 let cloudState=null;
 let inviteActivated=false;
 const backend=route=>{
  const p=new URL(route.request().url()).pathname;let data=[];
  if(p.endsWith('/edpvz_points'))data=[{point_id:'5000',name:'Тестовый',owner_id:uid}];
  if(p.endsWith('/edpvz_memberships'))data=[{point_id:'5000',user_id:staff,status:'approved'}];
  if(p.endsWith('/edpvz_profiles'))data=route.request().url().includes('select=role')?[{role:'owner'}]:[{user_id:staff,username:'fixture_employee',role:'employee'}];
  if(p.endsWith('/edpvz_user_data'))data=cloudState?[{payload:cloudState}]:[];
  if(p.endsWith('/edpvz_dispute_redeem_password')){
   const body=route.request().postDataJSON();
   if(body){
    assert.equal(body.p_password,'Synthetic-test-password-2026');
    inviteActivated=true;data={organization_id:'org01'};
   }
  }
  if(p.endsWith('/edpvz_dispute_owner_access')){
   const body=route.request().postDataJSON();
   if(body?.p_action==='redeem'){
    assert.equal(body.p_code,'PVZ-0123456789ABCDEF0123456789ABCDEF');
    inviteActivated=true;data={organization_id:'org01'};
   }
   if(body?.p_action==='list')data=inviteActivated?[{id:'org01',name:'Тестовый собственник'}]:[];
   if(body?.p_action==='read'){
    assert.equal(body.p_org,'org01');
    data={points:[{id:'5000',name:'Тестовая точка'}],rows:[{id:'case01',point_id:'5000',title:'Тестовое удержание',amount:200}]};
   }
  }
  if(p.endsWith('/edpvz_calendar_write')){const body=route.request().postDataJSON();if(body.p_revision!==(cloudState?.revision||0))data={conflict:true,...cloudState};else{cloudState={revision:body.p_revision+1,data:body.p_data};data=cloudState}}
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data),headers:{'access-control-allow-origin':'*'}});
 };
 await context.route('https://duerixyhzapotoeclggz.supabase.co/**',backend);
 await context.route(/https:\/\/(?!duerixyhzapotoeclggz\.supabase\.co)/,r=>r.abort());
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/');await page.getByRole('link',{name:'Управление моими пунктами Команда, смены, задачи и все инструменты ПВЗ'}).click();
 const frame=page.frameLocator('#viewer');
 await frame.getByRole('link',{name:'Сотрудники Локальные карточки и архив'}).click();
 await frame.getByRole('heading',{name:'Сотрудники',exact:true}).waitFor();
 assert.equal(await frame.locator('#tasks').isVisible(),false);
 assert.equal(await frame.locator('#management-home').isVisible(),false);
 await frame.getByLabel('ФИО').fill('Тестовый менеджер');
 await frame.locator('#employees').getByLabel('ПВЗ / адрес').fill('Тестовая точка');
 await frame.getByRole('button',{name:'Добавить сотрудника'}).click();
 await frame.getByRole('link',{name:'К моим ПВЗ'}).click();
 await frame.getByRole('link',{name:'Задачи Поручения и статусы'}).click();
 await frame.getByRole('heading',{name:'Задачи менеджерам',exact:true}).waitFor();
 assert.equal(await frame.locator('#employees').isVisible(),false);
 assert.equal(await frame.locator('#requests').isVisible(),false);
 assert.match(decodeURIComponent(page.url()),/section=tasks/);
 await frame.getByLabel('Задача',{exact:true}).fill('Проверить остатки');
 await frame.locator('#tasks').getByLabel('ПВЗ / адрес').selectOption('Тестовая точка');
 await frame.getByLabel('Исполнитель').selectOption({label:'Тестовый менеджер'});
 await frame.getByRole('button',{name:'Создать задачу'}).click();
 await page.reload();
 await frame.getByText('Проверить остатки',{exact:true}).waitFor();
 await frame.getByRole('link',{name:'К моим ПВЗ'}).click();
 await frame.getByRole('link',{name:'Обращения Журнал обращений'}).click();
 await frame.getByRole('heading',{name:'Учёт обращений',exact:true}).waitFor();
 assert.equal(await frame.locator('#tasks').isVisible(),false);
 await page.getByRole('button',{name:'Назад',exact:true}).click();
 await frame.getByRole('heading',{name:'Управление ПВЗ',exact:true}).waitFor();
 await frame.getByRole('link',{name:'Календарь смен Графики сотрудников'}).click();
 await frame.getByText('Команда аккаунта обновлена.',{exact:false}).waitFor();
 assert.equal(await page.locator('.appbar:visible').count(),1);assert.equal(await frame.locator('#viewer').count(),0);
 assert.match(await page.locator('#external').getAttribute('href'),/\/apps\/control\/$/);
 assert.match(await frame.locator('#app').innerText(),/Тестовый/);
 await frame.locator('.day').nth(4).click();
 assert.match(await frame.locator('select[name="person"]').innerText(),/fixture_employee/);
 await frame.getByRole('button',{name:'Добавить смену',exact:true}).click();
 assert.match(await frame.locator('#sheet-root').innerText(),/fixture_employee/);
 await page.reload();await frame.getByText('Команда аккаунта обновлена.',{exact:false}).waitFor();
 const current=page.frames().find(f=>f.url().includes('/apps/control/'));
 assert.equal(await current.evaluate(()=>db.shifts.length),1);
 assert.equal(await current.evaluate(()=>db.people.length),1);
 // A second device starts empty and receives the full calendar.
 await current.evaluate(()=>synchronizeCalendar());
 assert.equal(cloudState.data.shifts.length,1);
 const other=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await other.addInitScript(({uid})=>localStorage.setItem('edpvz-auth-v1',JSON.stringify({access_token:'synthetic-test-token',expires_at:9999999999,user:{id:uid}})),{uid});
 await other.route('https://duerixyhzapotoeclggz.supabase.co/**',backend);
 const second=await other.newPage();second.on('pageerror',e=>errors.push(e.message));await second.goto(base+'/apps/control/');
 await second.getByText('Команда аккаунта обновлена.',{exact:false}).waitFor();
 assert.equal(await second.evaluate(()=>db.shifts.length),1);assert.equal(await second.evaluate(()=>db.people.length),1);
 await second.evaluate(()=>commit(()=>db.people[0].rate=2500));await second.evaluate(()=>synchronizeCalendar());
 await current.evaluate(()=>synchronizeCalendar());assert.equal(await current.evaluate(()=>db.people[0].rate),2500);
 assert.equal(await current.evaluate(()=>db.shifts.length),1);
 await other.close();
 // Old nested portal URLs are flattened into the same outer frame.
 await page.goto(base+'/#section='+encodeURIComponent(base+'/apps/management/'));
 await frame.getByRole('heading',{name:'Управление ПВЗ',exact:true}).waitFor();
 await page.locator('#viewer').evaluate((el,url)=>{el.src=url},base+'/#section='+encodeURIComponent(base+'/apps/control/'));
 await page.frameLocator('#viewer').getByText('Команда аккаунта обновлена.',{exact:false}).waitFor();
 assert.equal(await page.frameLocator('#viewer').locator('#viewer').count(),0);
 assert.equal(await page.locator('.appbar:visible').count(),1);
 await page.goto(base+'/');
 assert.equal(await page.locator('#owner-disputes').isVisible(),false);
 await page.getByRole('button',{name:'Ввести пароль к удержаниям',exact:true}).click();
 assert.equal(await page.locator('#search').getAttribute('type'),'password');
 await page.locator('#search').fill('Synthetic-test-password-2026');
 await page.locator('#search').press('Enter');
 await page.getByRole('link',{name:/Мои удержания Удержания по вашим ПВЗ/}).click();
 await frame.getByText('Тестовое удержание',{exact:true}).waitFor();
 await page.reload();
 await frame.getByText('Тестовое удержание',{exact:true}).waitFor();
 inviteActivated=false;
 await frame.getByRole('button',{name:'Обновить',exact:true}).click();
 await frame.getByText('Введи код доступа в поиске на главной странице.',{exact:true}).waitFor();
 assert.equal(await frame.getByText('Тестовое удержание',{exact:true}).count(),0);
 assert.deepEqual(errors,[]);console.log('PASS owner password activation, scoped page, reload and revocation, separate management screens and task persistence, mobile navigation, nested portal recovery, cloud employee picker, shift save/reload, second-device calendar and salary synchronization');
 await context.close();
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
