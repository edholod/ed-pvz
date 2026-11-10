import os, asyncio, time, re, json, secrets, html
from datetime import datetime, timezone
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.tl.types import User, Channel
from telethon.tl.functions.channels import GetForumTopicsRequest
from telethon.errors import SessionPasswordNeededError, PhoneCodeInvalidError, PhoneCodeExpiredError
import httpx

app=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)
CHANNELS=['pvz_zamena','mskpodmena','marketplacepvz','whitelistpvz','zamena_vPVZ','OZONpvzArh','rabotapvz','pvz889','OnlinePvz','rabotapvzoff','pvzrabota','pvzzamena','Rabota_Zamena_PVZ','spbpvz','rabota_v_pvz','tochka_pvz','wildberries_ozone_help','pvzworks']
# Message links supplied by the portal owner. These are message IDs, not necessarily topic IDs.
SEED_MESSAGES={
    'pvz_zamena':[8984,6854,911,5626,912,910,546],
    'Rabota_Zamena_PVZ':[265771,265773],
    'marketplacepvz':[77922,99104,99101,99107,99102,99105,99109,99108,99113,99112],
}
API_ID=int(os.getenv('TELEGRAM_API_ID','0'))
API_HASH=os.getenv('TELEGRAM_API_HASH','')
ADMIN_TOKEN=os.getenv('COLLECTOR_ADMIN_TOKEN','')
SESSION=os.getenv('TELEGRAM_SESSION','')
SUPABASE_URL=os.getenv('SUPABASE_URL','').rstrip('/')
INGEST_TOKEN=os.getenv('COLLECTOR_INGEST_TOKEN','')
ANON_KEY=os.getenv('SUPABASE_ANON_KEY','')
DB_HEADERS={'apikey':ANON_KEY,'authorization':'Bearer '+ANON_KEY,'content-type':'application/json'}
client=None
phone_hash=None
last_run=0
state={'authorized':False,'count':0,'channels':{},'last_sync':None,'error':None}

def authorize(request):
    supplied=request.headers.get('x-admin-token','')
    if not ADMIN_TOKEN or not secrets.compare_digest(supplied,ADMIN_TOKEN):
        raise HTTPException(403,'Access denied')

async def get_client():
    global client
    if not API_ID or not API_HASH: raise RuntimeError('Telegram API credentials missing in Render')
    if client is None:
        client=TelegramClient(StringSession(SESSION),API_ID,API_HASH,device_model='Ed PVZ Collector',app_version='1.0',auto_reconnect=True)
        await client.connect()
    return client

@app.get('/health')
async def health():
    return {'ok':True,'configured':bool(API_ID and API_HASH),'authorized':state['authorized'],'last_sync':state['last_sync'],'count':state['count'],'channels':state['channels'],'error':state['error']}

@app.post('/admin/send-code')
async def send_code(request:Request):
    authorize(request)
    data=await request.json()
    phone=str(data.get('phone','')).strip()
    if not re.fullmatch(r'\+\d{9,15}',phone):raise HTTPException(400,'Phone must be international format')
    c=await get_client()
    if await c.is_user_authorized():return {'authorized':True}
    global phone_hash
    result=await c.send_code_request(phone)
    phone_hash=(phone,result.phone_code_hash)
    return {'sent':True,'message':'Enter the code in this protected form. Never send it to ChatGPT.'}

@app.post('/admin/sign-in')
async def sign_in(request:Request):
    authorize(request)
    data=await request.json()
    if not phone_hash:raise HTTPException(400,'Request a code first')
    c=await get_client()
    try:
        await c.sign_in(phone=phone_hash[0],code=str(data.get('code','')).strip(),phone_code_hash=phone_hash[1])
    except SessionPasswordNeededError:
        return {'password_required':True}
    except (PhoneCodeInvalidError,PhoneCodeExpiredError) as e:
        raise HTTPException(400,str(e))
    await persist_session(c)
    return {'authorized':True,'session_saved':True}

@app.post('/admin/password')
async def password(request:Request):
    authorize(request)
    c=await get_client()
    data=await request.json()
    await c.sign_in(password=str(data.get('password','')))
    await persist_session(c)
    return {'authorized':True,'session_saved':True}

@app.post('/admin/sync')
async def sync_now(request:Request):
    authorize(request)
    return await collect()

@app.get('/admin',response_class=HTMLResponse)
async def admin_page():
    return HTMLResponse("""<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>Ed PVZ — Telegram</title><style>body{font:16px system-ui;max-width:520px;margin:24px auto;padding:18px;background:#faf7fb;color:#29222d}input,button{font:inherit;padding:13px;width:100%;box-sizing:border-box;margin:8px 0;border-radius:10px;border:1px solid #b9a4b8}button{background:#85316f;color:white}pre{white-space:pre-wrap;overflow-wrap:anywhere}p{line-height:1.5}</style><h2>Ed PVZ — Telegram</h2><p>Защищённая авторизация второго аккаунта. Не отправляйте коды, пароль или строку сессии в чат. Все действия выполняются на этом сайте.</p><input id="token" type="password" placeholder="COLLECTOR_ADMIN_TOKEN"><input id="phone" placeholder="+79991234567"><button onclick="send()">Получить код Telegram</button><input id="code" placeholder="Код из Telegram"><button onclick="signin()">Войти по коду</button><input id="pass" type="password" placeholder="Облачный пароль (если нужен)"><button onclick="password()">Подтвердить пароль</button><button onclick="sync()">Проверить сбор сообщений</button><pre id="out"></pre><script>async function call(path,data){try{const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json','x-admin-token':document.getElementById('token').value},body:JSON.stringify(data)});const v=await r.json();document.getElementById('out').textContent=JSON.stringify(v,null,2);if(v.session_saved)document.getElementById('out').textContent='Авторизация успешна. Сессия защищённо сохранена в базе и будет восстановлена после перезапуска.'}catch(e){document.getElementById('out').textContent=String(e)}}function send(){call('/admin/send-code',{phone:document.getElementById('phone').value})}function signin(){call('/admin/sign-in',{code:document.getElementById('code').value})}function password(){call('/admin/password',{password:document.getElementById('pass').value})}function sync(){call('/admin/sync',{})}</script></html>""")

async def rpc(name,payload):
    async with httpx.AsyncClient(timeout=35) as h:
        r=await h.post(SUPABASE_URL+'/rest/v1/rpc/'+name,headers=DB_HEADERS,json=payload)
        r.raise_for_status()
        return r.json()

async def persist_session(c):
    if not (SUPABASE_URL and ANON_KEY and INGEST_TOKEN):raise RuntimeError('Database session store not configured')
    await rpc('edpvz_telegram_ingest',{'p_token':INGEST_TOKEN,'p_items':[],'p_session':c.session.save()})

async def restore_session():
    global client
    if not (SUPABASE_URL and ANON_KEY and INGEST_TOKEN):return False
    saved=await rpc('edpvz_telegram_session',{'p_token':INGEST_TOKEN})
    if not saved:return False
    if client is not None:await client.disconnect()
    client=TelegramClient(StringSession(saved),API_ID,API_HASH,device_model='Ed PVZ Collector',app_version='1.0',auto_reconnect=True)
    await client.connect()
    return await client.is_user_authorized()

async def collect():
    global last_run
    if time.time()-last_run<240:return {'cached':True,**state}
    c=await get_client()
    if not await c.is_user_authorized():
        state['authorized']=False
        return {'authorized':False,'message':'Account authorization required'}
    state['authorized']=True
    items=[]
    statuses={}
    for name in CHANNELS:
        try:
            entity=await c.get_entity(name)
            count=0
            topics=[]
            if isinstance(entity,Channel) and getattr(entity,'forum',False):
                try:
                    offset_date=None
                    offset_id=0
                    offset_topic=0
                    for _ in range(10):
                        page=await c(GetForumTopicsRequest(channel=entity,offset_date=offset_date,offset_id=offset_id,offset_topic=offset_topic,limit=100,q=''))
                        batch=list(getattr(page,'topics',[]) or [])
                        if not batch:break
                        topics.extend(t.id for t in batch if getattr(t,'id',None))
                        if len(batch)<100:break
                        tail=batch[-1]
                        offset_topic=tail.id
                        offset_id=getattr(tail,'top_message',0)
                        offset_date=getattr(tail,'date',None)
                except Exception as topic_error:
                    statuses[name]={'ok':False,'error':'ForumTopics:'+type(topic_error).__name__}
            # Resolve supplied message links to their actual topic roots.
            seed_messages=SEED_MESSAGES.get(name,[])
            seed_topics=[]
            if seed_messages:
                try:
                    samples=await c.get_messages(entity,ids=seed_messages)
                    for sample in samples:
                        if sample is None:continue
                        reply=getattr(sample,'reply_to',None)
                        root=getattr(reply,'reply_to_top_id',None) or getattr(reply,'reply_to_msg_id',None)
                        if root:seed_topics.append(root)
                        elif isinstance(entity,Channel) and getattr(entity,'forum',False):
                            # A supplied link may itself point at a topic starter.
                            seed_topics.append(sample.id)
                except Exception as seed_error:
                    statuses[name]={'ok':False,'error':'SeedResolve:'+type(seed_error).__name__}
            topics=list(dict.fromkeys(topics+seed_topics))
            seen=set()
            async def history():
                async for message in c.iter_messages(entity,limit=350):
                    yield message
                for topic in topics:
                    try:
                        async for message in c.iter_messages(entity,reply_to=topic,limit=100):
                            yield message
                    except Exception:
                        continue
            async for msg in history():
                if msg.id in seen:continue
                seen.add(msg.id)
                text=(msg.message or '').strip()
                if len(text)<12:continue
                if not re.search(r'пвз|пункт выдачи|смен|замен|подмен|работ|сотрудник|ваканси|wb|ozon|вб|озон',text,re.I):continue
                sender=await msg.get_sender()
                author={}
                if isinstance(sender,User) and not sender.bot:
                    display=' '.join(filter(None,[sender.first_name,sender.last_name])).strip()
                    author={'author_id':sender.id,'author_username':sender.username,'author_name':display or sender.username or 'Пользователь Telegram','author_url':('https://t.me/'+sender.username if sender.username else 'tg://user?id='+str(sender.id))}
                topic_id=getattr(getattr(msg,'reply_to',None),'reply_to_top_id',None) or getattr(getattr(msg,'reply_to',None),'reply_to_msg_id',None)
                # Forum messages have unique message IDs; preserve the topic in the deep link.
                link=f'https://t.me/{name}/{msg.id}' + (f'?thread={topic_id}' if topic_id else '')
                items.append({'id':f'tg:{name}:{msg.id}','source':name,'url':link,'text':text[:2400],'published_at':msg.date.isoformat() if msg.date else None,'marketplaces':(['wb'] if re.search(r'wb|вб|wildberries|вайлдбер',text,re.I) else [])+(['ozon'] if re.search(r'ozon|озон',text,re.I) else []),'kind':'resume' if re.search(r'ищу работу|ищу смен|выйду на замен|ищу подработ',text,re.I) else 'vacancy',**author})
                count+=1
            statuses[name]={'ok':True,'posts':count,'topics':len(topics),'seed_links':len(seed_messages)}
        except Exception as e:
            statuses[name]={'ok':False,'error':type(e).__name__}
    # Every source is isolated: a missing/private forum cannot interrupt other groups.
    # Telethon iter_messages on a forum supergroup returns messages from its topics
    # as part of the channel history; topic links are preserved when available.
    items.sort(key=lambda x:x['published_at'] or '',reverse=True)
    state.update({'count':len(items),'channels':statuses,'last_sync':datetime.now(timezone.utc).isoformat(),'error':None})
    if SUPABASE_URL and INGEST_TOKEN and ANON_KEY:
        try:
            saved=await rpc('edpvz_telegram_ingest',{'p_token':INGEST_TOKEN,'p_items':items})
            state['saved']=saved.get('saved',0)
        except Exception as e:
            state['error']='Database save failed: '+type(e).__name__+': '+str(e)[:120]
            return {'authorized':True,**state}
    last_run=time.time()
    return {'authorized':True,**state}

@app.on_event('startup')
async def start():
    async def loop():
        while True:
            try:
                if not SESSION and client is None:
                    await restore_session()
                await collect()
            except Exception as e:
                state['error']=type(e).__name__+': '+str(e)[:100]
            await asyncio.sleep(300)
    asyncio.create_task(loop())

@app.get('/avito/status')
async def avito_status():
    """Server-only credential check; never exposes OAuth secrets or tokens."""
    configured=bool(os.getenv('AVITO_CLIENT_ID') and os.getenv('AVITO_CLIENT_SECRET'))
    if not configured:
        return {'connected':False,'items':[],'reason':'avito_credentials_not_configured','integration_version':2}
    try:
        async with httpx.AsyncClient(timeout=18) as h:
            response=await h.post('https://api.avito.ru/token/',data={
                'grant_type':'client_credentials',
                'client_id':os.getenv('AVITO_CLIENT_ID'),
                'client_secret':os.getenv('AVITO_CLIENT_SECRET')})
        if response.status_code!=200:
            return {'connected':False,'items':[],'reason':'avito_oauth_failed','upstream_status':response.status_code}
        token=response.json().get('access_token')
        if not token:
            return {'connected':False,'items':[],'reason':'avito_token_missing'}
        return {'connected':True,'items':[],'reason':'avito_oauth_ok_vacancy_search_not_verified'}
    except Exception as exc:
        return {'connected':False,'items':[],'reason':'avito_oauth_unreachable','error_type':type(exc).__name__}
