import os, asyncio, time, re, json, secrets, html
from datetime import datetime, timezone
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.errors import SessionPasswordNeededError, PhoneCodeInvalidError, PhoneCodeExpiredError
import httpx

app=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)
CHANNELS=['pvz_zamena','mskpodmena','marketplacepvz','whitelistpvz','zamena_vPVZ','OZONpvzArh','rabotapvz','pvz889']
API_ID=int(os.getenv('TELEGRAM_API_ID','0'))
API_HASH=os.getenv('TELEGRAM_API_HASH','')
ADMIN_TOKEN=os.getenv('COLLECTOR_ADMIN_TOKEN','')
SESSION=os.getenv('TELEGRAM_SESSION','')
SUPABASE_URL=os.getenv('SUPABASE_URL','').rstrip('/')
INGEST_TOKEN=os.getenv('COLLECTOR_INGEST_TOKEN','')
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
    return {'authorized':True,'session':c.session.save(),'warning':'Save this session ONLY as Render secret TELEGRAM_SESSION, never share it in chat.'}

@app.post('/admin/password')
async def password(request:Request):
    authorize(request)
    c=await get_client()
    data=await request.json()
    await c.sign_in(password=str(data.get('password','')))
    return {'authorized':True,'session':c.session.save(),'warning':'Save session in Render TELEGRAM_SESSION secret.'}

@app.post('/admin/sync')
async def sync_now(request:Request):
    authorize(request)
    return await collect()

@app.get('/admin',response_class=HTMLResponse)
async def admin_page():
    return HTMLResponse("""<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>Ed PVZ — Telegram</title><style>body{font:16px system-ui;max-width:520px;margin:24px auto;padding:18px;background:#faf7fb;color:#29222d}input,button{font:inherit;padding:13px;width:100%;box-sizing:border-box;margin:8px 0;border-radius:10px;border:1px solid #b9a4b8}button{background:#85316f;color:white}pre{white-space:pre-wrap;overflow-wrap:anywhere}p{line-height:1.5}</style><h2>Ed PVZ — Telegram</h2><p>Защищённая авторизация второго аккаунта. Не отправляйте коды, пароль или строку сессии в чат. Все действия выполняются на этом сайте.</p><input id="token" type="password" placeholder="COLLECTOR_ADMIN_TOKEN"><input id="phone" placeholder="+79991234567"><button onclick="send()">Получить код Telegram</button><input id="code" placeholder="Код из Telegram"><button onclick="signin()">Войти по коду</button><input id="pass" type="password" placeholder="Облачный пароль (если нужен)"><button onclick="password()">Подтвердить пароль</button><button onclick="sync()">Проверить сбор сообщений</button><pre id="out"></pre><script>async function call(path,data){try{const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json','x-admin-token':document.getElementById('token').value},body:JSON.stringify(data)});const v=await r.json();document.getElementById('out').textContent=JSON.stringify(v,null,2);if(v.session)document.getElementById('out').textContent='Авторизация успешна. Строка сессии получена, но для безопасности она не выводится на странице. Для постоянного хранения потребуется серверное хранилище.'}catch(e){document.getElementById('out').textContent=String(e)}}function send(){call('/admin/send-code',{phone:document.getElementById('phone').value})}function signin(){call('/admin/sign-in',{code:document.getElementById('code').value})}function password(){call('/admin/password',{password:document.getElementById('pass').value})}function sync(){call('/admin/sync',{})}</script></html>""")

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
            async for msg in c.iter_messages(entity,limit=60):
                text=(msg.message or '').strip()
                if len(text)<12:continue
                if not re.search(r'пвз|пункт выдачи|смен|замен|подмен|работ|сотрудник|ваканси|wb|ozon|вб|озон',text,re.I):continue
                items.append({'id':f'tg:{name}:{msg.id}','source':name,'url':f'https://t.me/{name}/{msg.id}','text':text[:2400],'published_at':msg.date.isoformat() if msg.date else None,'marketplaces':(['wb'] if re.search(r'wb|вб|wildberries|вайлдбер',text,re.I) else [])+(['ozon'] if re.search(r'ozon|озон',text,re.I) else []),'kind':'resume' if re.search(r'ищу работу|ищу смен|выйду на замен|ищу подработ',text,re.I) else 'vacancy'})
                count+=1
            statuses[name]={'ok':True,'posts':count}
        except Exception as e:
            statuses[name]={'ok':False,'error':type(e).__name__}
    items.sort(key=lambda x:x['published_at'] or '',reverse=True)
    state.update({'count':len(items),'channels':statuses,'last_sync':datetime.now(timezone.utc).isoformat(),'error':None})
    last_run=time.time()
    if SUPABASE_URL and INGEST_TOKEN:
        async with httpx.AsyncClient(timeout=30) as h:
            r=await h.post(SUPABASE_URL+'/functions/v1/edpvz-telegram-ingest',headers={'x-collector-token':INGEST_TOKEN},json={'items':items,'status':statuses})
            if r.status_code!=200:state['error']='Supabase ingest HTTP '+str(r.status_code)
    return {'authorized':True,**state}

@app.on_event('startup')
async def start():
    async def loop():
        while True:
            try:
                if SESSION:await collect()
            except Exception as e:
                state['error']=type(e).__name__+': '+str(e)[:100]
            await asyncio.sleep(300)
    asyncio.create_task(loop())
