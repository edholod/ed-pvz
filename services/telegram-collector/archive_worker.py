"""Authenticated archive preparation, independent of provider MP4 export limits."""
import asyncio
import base64
import hashlib
import hmac
import json
import math
import os
import re
import secrets
import shutil
import time
import urllib.request
import urllib.error
from pathlib import Path
from urllib.parse import urlparse, urljoin

import httpx
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse

router = APIRouter(prefix='/archive')
BASE = os.environ.get('SUPABASE_URL', 'https://duerixyhzapotoeclggz.supabase.co').rstrip('/')
PUBLIC_URL = os.environ.get('ARCHIVE_PUBLIC_URL','https://edpvz-archive.onrender.com').rstrip('/')
ANON = os.environ.get('SUPABASE_ANON_KEY') or 'sb_publishable_fKE2S2rAz7VMa54rgO4uvQ_vyzFPwmV'
ROOT = Path(os.environ.get('ARCHIVE_WORK_DIR', '/tmp/edpvz-archive-files'))
ROOT.mkdir(parents=True, exist_ok=True)
JOBS = {}
TASKS = set()
LOCK = asyncio.Semaphore(1)
SIGNING_KEY = os.environ.get('ARCHIVE_SIGNING_KEY', '')
DISK_TOKEN = os.environ.get('ARCHIVE_YANDEX_STORAGE_TOKEN', '').strip()
DISK_API = 'https://cloud-api.yandex.net/v1/disk/resources'
DISK_PREFIX = 'app:/edpvz-'
DISK_QUOTA = 100_000_000_000
DISK_TTL = 86400
PROFILES = {'source': None, '1080': 1080, '720': 720, '480': 480}
EXPORT_ENABLED = os.environ.get('ARCHIVE_EXPORT_ENABLED','false').lower() == 'true'


def clean_name(value):
    value = re.sub(r'[\x00-\x1f/\\:*?"<>|]', '_', str(value)).strip(' .')[:110]
    return value or 'Запись'


def chunks(start, end, size=900):
    while start < end:
        stop = min(end, start + size)
        yield start, stop
        start = stop


async def auth(request):
    header = request.headers.get('authorization', '')
    if not header.startswith('Bearer '):
        raise HTTPException(401, 'Войди в аккаунт «Эд ПВЗ».')
    headers = {'apikey': ANON, 'authorization': header, 'content-type': 'application/json'}
    async with httpx.AsyncClient(timeout=12) as client:
        identity = await client.get(BASE + '/auth/v1/user', headers=headers)
        if identity.status_code != 200:
            raise HTTPException(401, 'Обнови вход в аккаунт «Эд ПВЗ».')
        allowed = await client.post(BASE + '/rest/v1/rpc/edpvz_ivideon_allowed', headers=headers, json={})
    if allowed.status_code != 200 or allowed.json() is not True:
        raise HTTPException(403, 'Раздел доступен собственнику.')
    return identity.json()['id'], headers


async def edge(job, payload):
    headers={**job['headers'], 'origin':'https://edpvz.ru'}
    async with httpx.AsyncClient(timeout=25) as client:
        result = await client.post(BASE + '/functions/v1/edpvz-ivideon-check', headers=headers, json=payload)
    if result.status_code != 200:
        data = result.json()
        raise RuntimeError(data.get('error', 'Ivideon не отдал запись.'))
    data=result.json()
    if data.get('sealedSource'):
        packed=base64.urlsafe_b64decode(data['sealedSource']+'='*((-len(data['sealedSource']))%4))
        key=hashlib.sha256(('edpvz-archive-ingest:'+headers['authorization']).encode()).digest()
        clear=json.loads(AESGCM(key).decrypt(packed[:12],packed[12:],None))
        if clear['expires']<time.time()*1000:
            raise RuntimeError('Ссылка Ivideon устарела. Повтори подготовку.')
        data['sourceUrl']=media_url(clear['url'])
        del data['sealedSource']
    return data


def media_url(value):
    parsed = urlparse(value)
    if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port:
        raise RuntimeError('Неверный адрес видеосервера.')
    if parsed.hostname == urlparse(BASE).hostname and parsed.path == '/functions/v1/edpvz-ivideon-check' and parsed.query.startswith(('download=','hls=')):
        return value
    if not any(parsed.hostname == d or parsed.hostname.endswith('.' + d) for d in ('ivideon.com', 'iv-cdn.com', 'extcam.com')):
        raise RuntimeError('Неверный домен видеосервера.')
    return value


async def process(args, job, timeout=None):
    if job.get('cancelled'):
        raise RuntimeError('Подготовка отменена.')
    proc = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    job['process'] = proc
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        if job.get('cancelled'):
            raise RuntimeError('Подготовка отменена.')
        if proc.returncode:
            # ffmpeg logs contain private media URLs. Never expose them.
            categories = ['Option not found','Invalid argument','Protocol not found','not on whitelist','Server returned 403','Server returned 401','Server returned 404','Connection timed out','Input/output error','Error opening input','Unable to open resource','No such file','Invalid data found','Unrecognized option','Error while opening encoder','does not contain any stream']
            category = next((value for value in categories if value in err.decode(errors='ignore')), 'processing error')
            detail = re.sub(r'https?://[^\s\"\']+', '[media-url]', err.decode(errors='ignore'))
            detail = re.sub(r'xtok-[^\s]+', '[redacted]', detail)
            print('archive-process failed code=' + str(proc.returncode) + ' reason=' + category + ' detail=' + detail[-1800:].replace('\n', ' | '), flush=True)
            raise RuntimeError('Не удалось обработать видео (' + category + '). В записи может быть пробел или неподдерживаемый поток.')
        return out
    finally:
        if proc.returncode is None:
            proc.kill()
            await proc.wait()
        job.pop('process', None)


async def probe(path, job):
    raw = await process(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(path)], job, 60)
    info = json.loads(raw)
    video = next((x for x in info['streams'] if x['codec_type'] == 'video'), None)
    if not video:
        raise RuntimeError('В файле отсутствует видеодорожка.')
    fps = video.get('avg_frame_rate', '25/1').split('/')
    rate = float(fps[0]) / float(fps[1]) if len(fps) == 2 and float(fps[1]) else 25
    return float(video.get('duration') or info['format']['duration']), max(rate, 1), video['width'], video['height']


async def download_source(url,path,job):
    class SafeRedirect(urllib.request.HTTPRedirectHandler):
        max_redirections=5
        def redirect_request(self, request, fp, code, message, headers, newurl):
            return super().redirect_request(request,fp,code,message,headers,media_url(newurl))
    def transfer():
        request=urllib.request.Request(media_url(url),headers={'Accept-Encoding':'identity'})
        opener=urllib.request.build_opener(SafeRedirect())
        try:
            with opener.open(request,timeout=45) as response:
                media_url(response.geturl())
                if response.status not in (200,206):
                    raise RuntimeError('Ivideon не передал исходный файл.')
                if response.status==206 and not response.headers.get('Content-Range','').startswith('bytes 0-'):
                    raise RuntimeError('Ivideon вернул неправильную часть файла.')
                raw_size=response.headers.get('Content-Length','')
                expected=int(raw_size) if raw_size.isdigit() else None
                received=0
                with path.open('wb') as output:
                    while True:
                        if job.get('cancelled'):
                            raise RuntimeError('Подготовка отменена.')
                        if shutil.disk_usage(ROOT).free<128*1024*1024:
                            raise RuntimeError('На сервере недостаточно места для записи.')
                        block=response.read(64*1024)
                        if not block:break
                        output.write(block);received+=len(block)
                        job['message']='Получаем запись: '+str(round(received/1024))+' КБ'+(' из '+str(round(expected/1024))+' КБ' if expected else '')
                if received<1000 or (expected is not None and received!=expected):
                    raise RuntimeError('Исходный файл передан не полностью. Повтори подготовку.')
                print('archive-source received='+str(received),flush=True)
                return str(path)
        except urllib.error.HTTPError as error:
            raise RuntimeError('Ivideon отклонил скачивание файла (HTTP '+str(error.code)+').') from None
        except (urllib.error.URLError,TimeoutError):
            raise RuntimeError('Не удалось получить исходный файл Ivideon. Повтори подготовку.') from None
    async def download_ranges(client):
        offset = 0
        total = None
        with path.open('wb') as output:
            while total is None or offset < total:
                if job.get('cancelled'):
                    raise RuntimeError('Подготовка отменена.')
                if shutil.disk_usage(ROOT).free < 128 * 1024 * 1024:
                    raise RuntimeError('На сервере недостаточно места.')
                last = offset + 65535
                async with client.stream('GET', url, headers={
                    'Range': f'bytes={offset}-{last}', 'Accept-Encoding': 'identity'
                }) as response:
                    match = re.fullmatch(r'bytes (\d+)-(\d+)/(\d+)', response.headers.get('content-range', ''))
                    if response.status_code != 206 or not match:
                        raise RuntimeError('Ivideon не поддерживает скачивание файла частями.')
                    first, end, size = map(int, match.groups())
                    if first != offset or end != min(last, size - 1) or end < first or (total is not None and total != size):
                        raise RuntimeError('Ivideon вернул несовместимые части файла.')
                    total = size
                    received = 0
                    async for block in response.aiter_bytes():
                        received += len(block)
                        if received > end - first + 1:
                            raise RuntimeError('Ivideon вернул лишние байты.')
                        output.write(block)
                    if received != end - first + 1:
                        raise RuntimeError('Часть файла получена не полностью.')
                offset = end + 1
                job['message'] = f'Получаем запись: {offset // 1024} из {total // 1024} КБ'
        if offset < 1000:
            raise RuntimeError('Ivideon вернул слишком короткий файл.')
        return str(path)

    async def validate_request(request):
        media_url(str(request.url))
    try:
        try:
            async with httpx.AsyncClient(http2=True,follow_redirects=True,max_redirects=5,timeout=httpx.Timeout(90,read=20),event_hooks={'request':[validate_request]}) as client:
                async with client.stream('GET',url,headers={'Accept-Encoding':'identity'}) as response:
                    if response.status_code not in (200,206):
                        raise RuntimeError('Ivideon отклонил скачивание файла (HTTP '+str(response.status_code)+').')
                    if response.status_code==206 and not response.headers.get('content-range','').startswith('bytes 0-'):
                        raise RuntimeError('Ivideon вернул неправильную часть файла.')
                    print('archive-transfer headers status='+str(response.status_code)+' protocol='+response.http_version,flush=True)
                    size=response.headers.get('content-length','');expected=int(size) if size.isdigit() else None
                    received=0
                    with path.open('wb') as output:
                        async for block in response.aiter_bytes(64*1024):
                            if job.get('cancelled'):raise RuntimeError('Подготовка отменена.')
                            if shutil.disk_usage(ROOT).free<128*1024*1024:raise RuntimeError('На сервере недостаточно места.')
                            output.write(block);received+=len(block)
                            job['message']='Получаем запись: '+str(round(received/1024))+' КБ'+(' из '+str(round(expected/1024))+' КБ' if expected else '')
                    if received<1000 or (expected is not None and received!=expected):raise RuntimeError('Исходный файл передан не полностью.')
                    print('archive-source protocol='+response.http_version+' received='+str(received),flush=True)
                    return str(path)
        except (ImportError,httpx.TransportError) as error:
            print('archive-transfer fallback type='+type(error).__name__,flush=True)
            path.unlink(missing_ok=True)
            try:
                async with httpx.AsyncClient(http2=True, follow_redirects=True, max_redirects=5,
                                             timeout=httpx.Timeout(20), event_hooks={'request':[validate_request]}) as client:
                    return await download_ranges(client)
            except (RuntimeError, httpx.TransportError, ImportError):
                path.unlink(missing_ok=True)
                return await asyncio.to_thread(transfer)
    except Exception:
        path.unlink(missing_ok=True)
        raise


async def verify_frames(path,job,rate):
    raw=await process(['ffprobe','-v','error','-select_streams','v:0','-show_entries','packet=pts_time','-of','csv=p=0',str(path)],job,120)
    points=sorted(float(line.strip()) for line in raw.decode().splitlines() if line.strip() and line.strip()!='N/A')
    if not points or any(b-a>max(.3,3/rate) for a,b in zip(points,points[1:])):
        raise RuntimeError('В видеодорожке есть пропущенные кадры. Выбери непрерывный участок архива.')


async def export_source(job, clip, start, end):
    result=await edge(job,{'action':'load','cameraId':clip['cameraId'],'archive':{'mode':'export','start':start,'end':end}})
    export_id=result['exportId']
    print('archive-export created id='+str(export_id),flush=True)
    deadline=time.time()+600
    while time.time()<deadline:
        if job.get('cancelled'):
            raise RuntimeError('Подготовка отменена.')
        result=await edge(job,{'action':'load','cameraId':clip['cameraId'],'archive':{'mode':'export-status','exportId':export_id,'ingest':True}})
        if result['state']=='ready':
            job['message']='Скачиваем готовый файл Ivideon'
            print('archive-export ready id='+str(export_id),flush=True)
            return media_url(result.get('sourceUrl') or result['downloadUrl'])
        if result['state']=='failed':
            raise RuntimeError('Ivideon не подготовил экспорт этого участка.')
        job['message']='Ivideon готовит экспорт'+(' · '+str(result['progress'])+'%' if result.get('progress') is not None else '')
        await asyncio.sleep(3)
    raise RuntimeError('Ivideon не завершил экспорт за 10 минут. Попробуй меньший участок.')


async def disk_link(client, action, key):
    response = await client.get(DISK_API + '/' + action,
        headers={'Authorization': 'OAuth ' + DISK_TOKEN}, params={'path': key})
    if response.status_code != 200:
        raise RuntimeError('Яндекс Диск не выдал ссылку. Проверь подключение хранилища.')
    href = response.json().get('href', '')
    target = urlparse(href)
    if (target.scheme != 'https' or target.username or target.password or target.port
            or not (target.hostname or '').endswith('.yandex.net')):
        raise RuntimeError('Яндекс Диск вернул неподдерживаемый адрес.')
    return href


async def disk_usage(client):
    headers = {'Authorization': 'OAuth ' + DISK_TOKEN}
    offset = used = 0
    expired = []
    while True:
        response = await client.get(DISK_API, headers=headers,
                                    params={'path': 'app:/', 'limit': 100, 'offset': offset})
        if response.status_code != 200:
            raise RuntimeError('Не удалось прочитать папку приложения на Яндекс Диске.')
        embedded = response.json().get('_embedded', {})
        batch = embedded.get('items', [])
        for item in batch:
            size = int(item.get('size', 0))
            used += size
            name = item.get('name', '')
            match = re.fullmatch(r'edpvz-([0-9]{10})-[A-Za-z0-9_-]{24}-[0-9]+\.mp4', name)
            if match and int(match[1]) < time.time() - DISK_TTL and item.get('type') == 'file':
                expired.append(('app:/' + name, size))
        offset += len(batch)
        if not batch or offset >= embedded.get('total', offset):
            break
    for key, size in expired:
        response = await client.delete(DISK_API, headers=headers,
                                       params={'path': key, 'permanently': 'true'})
        if response.status_code in (204, 404):
            used -= size
    return used


async def daily_disk_cleanup():
    while True:
        try:
            async with LOCK, httpx.AsyncClient(timeout=30) as client:
                await disk_usage(client)
        except Exception:
            print('archive storage cleanup unavailable', flush=True)
        await asyncio.sleep(3600)


@router.on_event('startup')
async def start_disk_cleanup():
    if DISK_TOKEN:
        task = asyncio.create_task(daily_disk_cleanup())
        TASKS.add(task)
        task.add_done_callback(TASKS.discard)


async def store_archive(path, job_id, index):
    key = DISK_PREFIX + str(int(time.time())) + '-' + job_id + '-' + str(index) + '.mp4'
    size = path.stat().st_size
    headers = {'Authorization': 'OAuth ' + DISK_TOKEN}
    async with httpx.AsyncClient(timeout=120) as client:
        used = await disk_usage(client)
        if used + size > DISK_QUOTA:
            raise RuntimeError('Временное хранилище архива заполнено.')
        url = await disk_link(client, 'upload', key)
        async def blocks():
            with path.open('rb') as source:
                while block := await asyncio.to_thread(source.read, 1024 * 1024):
                    yield block
        response = await client.put(url, headers={'Content-Length': str(size), 'Content-Type': 'video/mp4'},
                                    content=blocks())
        if response.status_code not in (200, 201, 202):
            raise RuntimeError('Яндекс Диск не подтвердил сохранение MP4.')
        metadata = await client.get(DISK_API, headers=headers, params={'path': key})
        if metadata.status_code != 200 or metadata.json().get('size') != size:
            raise RuntimeError('Не удалось подтвердить целостность файла на Яндекс Диске.')
    return key


async def run(job):
    async with LOCK:
        if job.get('cancelled'):
            return
        folder = ROOT / job['id']
        folder.mkdir(exist_ok=True)
        job.update(state='processing', message='Подготавливаем запись')
        try:
            total = sum(x['end'] - x['start'] for x in job['clips'])
            completed = 0
            for index, clip in enumerate(job['clips']):
                job['message'] = 'Фрагмент ' + str(index + 1) + ' из ' + str(len(job['clips']))
                pieces = []
                piece_durations = []
                # Retry a refused interval by bisecting it, down to one minute.
                pending = list(chunks(clip['start'], clip['end']))
                width = None
                while pending:
                    start, end = pending.pop(0)
                    if shutil.disk_usage(ROOT).free < 256 * 1024 * 1024:
                        raise RuntimeError('На сервере недостаточно места. Скачай готовые файлы и повтори позже.')
                    path=folder/('part-'+str(index)+'-'+str(start)+'.mp4')
                    source=folder/('source-'+str(index)+'-'+str(start)+'.mp4')
                    try:
                        job['message']='Получаем архивный файл Ivideon'
                        source_url=await export_source(job,clip,start,end)
                        await download_source(source_url,source,job)
                        original_duration,original_fps,_,_=await probe(source,job)
                        if abs(original_duration-(end-start))>max(.15,2/original_fps):
                            raise RuntimeError('Ivideon вернул запись с другими границами времени. Точная склейка этого участка пока недоступна; файл не выдан.')
                        args=['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y','-filter_threads','1','-threads','1','-xerror','-err_detect','explode','-i',str(source),'-map','0:v:0','-map','0:a:0?','-t',str(end-start),'-threads','1']
                        target=PROFILES[job['quality']]
                        if width:
                            args+=['-vf',f'scale={width[0]}:{width[1]}:force_original_aspect_ratio=decrease,pad={width[0]}:{width[1]}:(ow-iw)/2:(oh-ih)/2,setsar=1']
                        elif target:
                            args+=['-vf',f"scale=-2:'min({target},ih)',setsar=1"]
                        args+=['-c:v','libx264','-preset','veryfast','-crf','19','-pix_fmt','yuv420p','-fps_mode','passthrough','-video_track_timescale','90000','-c:a','aac','-ar','48000','-af','aresample=async=1:first_pts=0','-movflags','+faststart',str(path)]
                        job['message']='Обрабатываем архивный файл'
                        try:
                            await process(args,job)
                        finally:
                            source.unlink(missing_ok=True)
                        duration,fps,w,h=await probe(path,job)
                        await verify_frames(path,job,fps)
                        if abs(duration-(end-start))>max(.05,2/fps):
                            raise RuntimeError('Длительность записи не совпадает с выбранным интервалом. В архиве может быть пропуск.')
                    except RuntimeError:
                        path.unlink(missing_ok=True);source.unlink(missing_ok=True)
                        if end-start > 60 and not job.get('cancelled'):
                            middle = (start+end)//2
                            pending[0:0] = [(start,middle),(middle,end)]
                            continue
                        raise
                    width = width or (w,h)
                    pieces.append(path)
                    piece_durations.append(end-start)
                    completed += end-start
                    job['progress'] = min(98, round(completed/total*98))
                output = folder / (str(index) + '.mp4')
                if len(pieces) == 1:
                    pieces[0].replace(output)
                else:
                    manifest = folder / ('concat-' + str(index) + '.txt')
                    manifest.write_text(''.join("file '" + str(p) + "'\nduration " + str(seconds) + "\n" for p, seconds in zip(pieces,piece_durations)))
                    await process(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(manifest),'-map','0','-c','copy','-movflags','+faststart',str(output)],job)
                duration, fps, w, h = await probe(output,job)
                await verify_frames(output,job,fps)
                if abs(duration-(clip['end']-clip['start'])) > max(.05,2/fps):
                    raise RuntimeError('Склейка не прошла проверку длительности. Файл не выдан.')
                job['files'].append({'id':str(index),'name':clip['name'] + '.mp4','size':output.stat().st_size,'duration':clip['end']-clip['start'],'measuredDuration':duration,'fps':fps,'width':w,'height':h,'path':str(output),'cameraId':clip['cameraId'],'cameraName':clip.get('cameraName','Камера'),'sourceStart':clip['start']})
                if DISK_TOKEN:
                    job['message'] = 'Сохраняем готовый MP4 на Яндекс Диск'
                    item = job['files'][-1]
                    item['diskKey'] = await store_archive(output, job['id'], index)
                    item.pop('path')
                    output.unlink()
                for part in pieces:
                    part.unlink(missing_ok=True)
            job.update(state='ready',progress=100,message='Файлы готовы')
        except Exception as exc:
            print('archive-job failed type='+type(exc).__name__,flush=True)
            job.update(state='cancelled' if job.get('cancelled') else 'failed',message=str(exc) if isinstance(exc,RuntimeError) else 'Подготовка прервана. Повтори запрос.')
        finally:
            job['updated'] = time.time()


def public_job(job):
    return {k:job[k] for k in ('id','state','progress','message','created')} | {'files':[{k:v for k,v in f.items() if k not in ('path','diskKey')} for f in job['files']]}


def owned(job_id, user):
    job = JOBS.get(job_id)
    if not job or job['user'] != user:
        raise HTTPException(404,'Подготовка не найдена или сервер перезапустился. Создай запрос снова.')
    return job


def expire():
    now = time.time()
    for key, job in list(JOBS.items()):
        abandoned = job['state'] == 'uploading' and not job.get('importBusy') and now-job['updated'] > 1800
        if abandoned or (job['state'] in ('ready','failed','cancelled') and now-job.get('updated',job['created']) > 86400):
            shutil.rmtree(ROOT/key,ignore_errors=True)
            del JOBS[key]


@router.get('/health')
async def health():
    return {'ok':bool(shutil.which('ffmpeg') and SIGNING_KEY), 'version':2, 'exportReady':EXPORT_ENABLED, 'temporaryDiskConfigured':bool(DISK_TOKEN), 'googleClientId':os.getenv('ARCHIVE_GOOGLE_CLIENT_ID',''), 'yandexClientId':os.getenv('ARCHIVE_YANDEX_CLIENT_ID','')}


@router.post('/jobs')
async def create(request: Request):
    user, headers = await auth(request)
    if not EXPORT_ENABLED:
        raise HTTPException(503,'Подготовка архива временно недоступна. Выбранные фрагменты сохранены в аккаунте.')
    data = await request.json()
    if not isinstance(data,dict) or data.get('quality') not in PROFILES or data.get('profile') not in ('auto','high','low'):
        raise HTTPException(400,'Выбери качество записи.')
    clips = data.get('clips')
    if not isinstance(clips,list) or not 1 <= len(clips) <= 50:
        raise HTTPException(400,'Добавь от 1 до 50 фрагментов.')
    now = int(time.time())
    normalized = []
    for clip in clips:
        if not isinstance(clip,dict) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,120}:[0-9]{1,8}',str(clip.get('cameraId',''))):
            raise HTTPException(400,'Некорректная камера.')
        start,end = clip.get('start'),clip.get('end')
        if type(start) is not int or type(end) is not int or not 0 < start < end <= now:
            raise HTTPException(400,'Укажи существующий интервал архива.')
        normalized.append({'cameraId':clip['cameraId'],'start':start,'end':end,'name':clean_name(clip.get('name','Запись')),'cameraName':str(clip.get('cameraName','Камера')).strip()[:200]})
    expire()
    request_id = data.get('requestId')
    if not isinstance(request_id,str) or not re.fullmatch(r'[a-zA-Z0-9-]{10,80}',request_id):
        raise HTTPException(400,'Некорректный номер запроса.')
    for j in JOBS.values():
        if j['user']==user and j['requestId']==request_id:
            return public_job(j)
    existing = [j for j in JOBS.values() if j['user']==user and j['state'] in ('queued','processing')]
    if len(existing) >= 2:
        raise HTTPException(409,'Уже готовятся два запроса. Дождись завершения или отмени один.')
    if len([j for j in JOBS.values() if j['state'] in ('queued','processing')]) >= 10:
        raise HTTPException(429,'Сервер занят подготовкой записей. Повтори позже.')
    job = {'id':secrets.token_urlsafe(18),'user':user,'headers':headers,'clips':normalized,'quality':data['quality'],'profile':data['profile'],'requestId':request_id,'state':'queued','message':'Ожидание обработки','progress':0,'files':[],'created':time.time()}
    JOBS[job['id']] = job
    task = asyncio.create_task(run(job))
    TASKS.add(task)
    task.add_done_callback(TASKS.discard)
    return public_job(job)


IMPORT_LIMIT = 2_000_000_000
IMPORT_PARTS = 12


@router.post('/jobs/import')
async def create_import(request: Request):
    user, _ = await auth(request)
    if not DISK_TOKEN:
        raise HTTPException(503, 'Яндекс Диск не подключён.')
    data = await request.json()
    sizes = data.get('sizes') if isinstance(data, dict) else None
    if (not isinstance(sizes, list) or not 1 <= len(sizes) <= IMPORT_PARTS
            or any(type(size) is not int or size < 16 for size in sizes)
            or sum(sizes) > IMPORT_LIMIT):
        raise HTTPException(400, 'Выбери до 12 MP4 общим размером до 2 ГБ.')
    expire()
    active = [j for j in JOBS.values() if j.get('importSizes') and j['state'] in ('uploading','queued','processing')]
    if any(j['user'] == user for j in active) or len(active) >= 2:
        raise HTTPException(409, 'Уже идёт сборка из файлов. Попробуй позже.')
    if shutil.disk_usage(ROOT).free < 2 * sum(sizes) + 256 * 1024 * 1024:
        raise HTTPException(507, 'На сервере недостаточно места для сборки.')
    now = time.time()
    job = {'id':secrets.token_urlsafe(18), 'user':user, 'state':'uploading',
           'created':now, 'updated':now, 'message':'Загружаем части', 'progress':0,
           'files':[], 'importSizes':sizes, 'importNext':0, 'importName':clean_name(data.get('name') or 'Объединённое видео')}
    (ROOT / job['id']).mkdir()
    JOBS[job['id']] = job
    return public_job(job)


@router.post('/jobs/{job_id}/import/{index}')
async def import_part(job_id: str, index: int, request: Request):
    user, _ = await auth(request)
    job = owned(job_id,user)
    sizes = job.get('importSizes')
    if not sizes or job['state'] != 'uploading' or index != job['importNext'] or job.get('importBusy'):
        raise HTTPException(409, 'Часть пришла не по порядку или загрузка завершена.')
    size = sizes[index]
    folder = ROOT / job_id
    part = folder / (str(index) + '-input.mp4')
    received = 0
    job['importBusy'] = True
    try:
        with part.open('wb') as output:
            async for block in request.stream():
                received += len(block)
                if received > size:
                    raise HTTPException(413, 'Размер части отличается от указанного.')
                output.write(block)
        if received != size:
            raise HTTPException(400, 'Часть получена не полностью.')
        with part.open('rb') as source:
            if source.read(8)[4:] != b'ftyp':
                raise HTTPException(400, 'Ожидается файл MP4.')
        job['importNext'] += 1
        job['updated'] = time.time()
        job['progress'] = int(70 * sum(sizes[:index+1]) / sum(sizes))
    except BaseException:
        part.unlink(missing_ok=True)
        raise
    finally:
        job['importBusy'] = False
    if job['importNext'] == len(sizes):
        job.update(state='queued',message='Части получены. Ожидаем сборку.')
        task = asyncio.create_task(merge_import(job))
        TASKS.add(task)
        task.add_done_callback(TASKS.discard)
    return public_job(job)


async def merge_import(job):
    folder = ROOT / job['id']
    try:
        async with LOCK:
            if job.get('cancelled'):
                return
            job.update(state='processing',message='Склеиваем MP4',progress=75)
            parts = [folder / (str(i) + '-input.mp4') for i in range(len(job['importSizes']))]
            expected = 0
            dimensions = None
            for part in parts:
                seconds, fps, width, height = await probe(part,job)
                if dimensions and dimensions != (width,height):
                    raise RuntimeError('Части имеют разное разрешение. Выбери экспорты одной камеры.')
                dimensions = (width,height)
                expected += seconds
            manifest = folder / 'inputs.txt'
            manifest.write_text(''.join("file " + part.name + "\n" for part in parts))
            output = folder / 'merged.mp4'
            await process(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-xerror','-y',
                           '-protocol_whitelist','file','-f','concat','-safe','1','-i',str(manifest),
                           '-map','0:v:0','-map','0:a:0?','-c','copy','-movflags','+faststart',str(output)],job,600)
            duration, fps, width, height = await probe(output,job)
            if abs(duration - expected) > max(0.5, 0.15 * len(parts)):
                raise RuntimeError('Склейка не прошла проверку длительности.')
            job.update(message='Сохраняем один MP4 на Яндекс Диск',progress=90)
            key = await store_archive(output,job['id'],0)
            job['files'].append({'id':'0','name':job['importName'].removesuffix('.mp4')+'.mp4',
                                 'size':output.stat().st_size,'duration':duration,'fps':fps,
                                 'width':width,'height':height,'diskKey':key,'sourceStart':0})
            job.update(state='ready',message='Один MP4 готов',progress=100)
    except Exception as error:
        print('archive import failed: ' + type(error).__name__,flush=True)
        job.update(state='cancelled' if job.get('cancelled') else 'failed',
                   message=str(error) if isinstance(error,RuntimeError) else 'Не удалось собрать MP4.')
    finally:
        job['updated'] = time.time()
        shutil.rmtree(folder,ignore_errors=True)


@router.post('/jobs/frame')
async def save_frame(request:Request):
    user, headers = await auth(request)
    raw = await request.body()
    if len(raw) > 24*1024*1024:
        raise HTTPException(413,'Кадр слишком большой.')
    try:
        data = json.loads(raw)
        image = base64.b64decode(data.get('jpeg',''),validate=True)
    except (ValueError,TypeError):
        raise HTTPException(400,'Не удалось прочитать кадр.')
    if not 4 <= len(image) <= 16*1024*1024 or not image.startswith(b'\xff\xd8') or not image.endswith(b'\xff\xd9'):
        raise HTTPException(400,'Ожидается кадр JPEG.')
    expire()
    job = {'id':secrets.token_urlsafe(18),'user':user,'headers':headers,'requestId':secrets.token_urlsafe(18),'state':'ready','message':'Кадр готов','progress':100,'files':[],'created':time.time(),'updated':time.time()}
    folder = ROOT/job['id']
    folder.mkdir()
    path=folder/'frame.jpg'
    try:
        path.write_bytes(image)
        info=json.loads(await process(['ffprobe','-v','error','-show_streams','-of','json',str(path)],job,30))
        stream=info['streams'][0]
        width,height=stream['width'],stream['height']
        if not 0<width<=16384 or not 0<height<=16384:
            raise ValueError('dimensions')
    except Exception:
        shutil.rmtree(folder,ignore_errors=True)
        raise HTTPException(400,'Кадр не прошёл проверку изображения.')
    job['files'].append({'id':'frame','name':clean_name(data.get('name','Кадр')).removesuffix('.jpg')+'.jpg','mime':'image/jpeg','size':len(image),'width':width,'height':height,'path':str(path)})
    JOBS[job['id']]=job
    return public_job(job)


@router.get('/jobs/{job_id}')
async def status(job_id:str, request:Request):
    user, headers = await auth(request)
    job = owned(job_id,user)
    job['headers'] = headers
    return public_job(job)


@router.post('/jobs/{job_id}/cancel')
async def cancel(job_id:str,request:Request):
    user,_ = await auth(request)
    job = owned(job_id,user)
    if job['state'] in ('uploading','queued','processing'):
        if job['state'] == 'uploading' and not job.get('importBusy'):
            shutil.rmtree(ROOT/job_id,ignore_errors=True)
        job['cancelled'] = True
        if job.get('process') and job['process'].returncode is None:
            job['process'].terminate()
        job.update(state='cancelled',message='Отменено',updated=time.time())
    return public_job(job)


@router.post('/jobs/{job_id}/file/{file_id}')
async def file_action(job_id:str,file_id:str,request:Request):
    user,_ = await auth(request)
    job = owned(job_id,user)
    item = next((f for f in job['files'] if f['id']==file_id),None)
    if not item or (not item.get('diskKey') and not Path(item['path']).is_file()):
        raise HTTPException(404,'Файл недоступен.')
    data = await request.json()
    if data.get('name') is not None:
        suffix = '.jpg' if item.get('mime') == 'image/jpeg' else '.mp4'
        item['name'] = clean_name(data['name']).removesuffix(suffix) + suffix
    if not SIGNING_KEY:
        raise HTTPException(503,'Скачивание временно недоступно.')
    expires = str(int(min(time.time() + (86400 if data.get('share') is True else 900),
                          job.get('updated', job['created']) + 86400)))
    content = job_id + ':' + file_id + ':' + expires
    signature = hmac.new(SIGNING_KEY.encode(),content.encode(),hashlib.sha256).hexdigest()
    return {'name':item['name'],'url':'/archive/download/' + job_id + '/' + file_id + '?expires=' + expires + '&signature=' + signature}


@router.get('/download/{job_id}/{file_id}')
async def download(job_id:str,file_id:str,expires:int,signature:str):
    content = job_id + ':' + file_id + ':' + str(expires)
    expected = hmac.new(SIGNING_KEY.encode(),content.encode(),hashlib.sha256).hexdigest()
    if not SIGNING_KEY or expires < time.time() or not hmac.compare_digest(signature,expected):
        raise HTTPException(403,'Ссылка устарела. Нажми «Скачать» заново.')
    job = JOBS.get(job_id)
    item = next((f for f in job['files'] if f['id']==file_id),None) if job else None
    if not item or (not item.get('diskKey') and not Path(item['path']).is_file()):
        raise HTTPException(404,'Файл недоступен.')
    if item.get('diskKey'):
        if time.time() - job.get('updated', job['created']) > DISK_TTL:
            raise HTTPException(404,'Срок хранения MP4 истёк.')
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                url = await disk_link(client, 'download', item['diskKey'])
        except (RuntimeError, httpx.HTTPError):
            raise HTTPException(502,'Яндекс Диск не выдал файл.') from None
        return RedirectResponse(url, headers={'Cache-Control':'private,no-store','Referrer-Policy':'no-referrer'})
    return FileResponse(item['path'],media_type=item.get('mime','video/mp4'),filename=item['name'],headers={'Cache-Control':'private,no-store'})

# Cloud OAuth credentials belong to EdPVZ's registered applications.
# Connection tokens are encrypted before being written under the user's RLS scope.
from base64 import urlsafe_b64encode
from cryptography.fernet import Fernet
from urllib.parse import urlencode

OAUTH_STATES = {}
CLOUD_LOCKS = {}


def cloud_cipher():
    if not SIGNING_KEY:
        raise HTTPException(503,'Подключение диска временно недоступно.')
    return Fernet(urlsafe_b64encode(hashlib.sha256(('cloud:' + SIGNING_KEY).encode()).digest()))


async def cloud_data(user, headers, provider, value=None):
    namespace = 'archive-cloud-' + provider
    url = BASE + '/rest/v1/edpvz_user_data'
    async with httpx.AsyncClient(timeout=15) as client:
        if value is not None:
            encrypted = cloud_cipher().encrypt(json.dumps(value).encode()).decode()
            response = await client.post(url + '?on_conflict=user_id,namespace',headers={**headers,'Prefer':'resolution=merge-duplicates,return=minimal'},json={'user_id':user,'namespace':namespace,'payload':{'encrypted':encrypted,'owner':user},'updated_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())})
            if response.status_code not in (200,201,204):
                raise HTTPException(502,'Не удалось сохранить подключение диска.')
            return value
        response = await client.get(url,headers=headers,params={'user_id':'eq.'+user,'namespace':'eq.'+namespace,'select':'payload'})
    if response.status_code != 200:
        raise HTTPException(502,'Не удалось прочитать подключение диска.')
    rows = response.json()
    if not rows:
        return {}
    payload = rows[0].get('payload') or {}
    if payload.get('owner') != user:
        raise HTTPException(403,'Доступ запрещён.')
    try:
        return json.loads(cloud_cipher().decrypt(payload['encrypted'].encode()))
    except Exception:
        raise HTTPException(409,'Подключи диск заново.')


def cloud_config(provider):
    if provider not in ('google','yandex'):
        raise HTTPException(400,'Неизвестный диск.')
    prefix = 'ARCHIVE_' + provider.upper()
    return os.getenv(prefix+'_CLIENT_ID',''),os.getenv(prefix+'_CLIENT_SECRET','')


@router.get('/cloud')
async def cloud_status(request:Request):
    user,headers = await auth(request)
    result = {}
    for provider in ('google','yandex'):
        client_id,secret = cloud_config(provider)
        stored = await cloud_data(user,headers,provider)
        result[provider] = {'configured':bool(client_id and secret),'connected':bool(stored.get('access_token'))}
    return result


@router.post('/cloud/{provider}/connect')
async def cloud_connect(provider:str,request:Request):
    user,headers = await auth(request)
    client_id,secret = cloud_config(provider)
    if not client_id or not secret:
        raise HTTPException(503,'OAuth-приложение для этого диска ещё не подключено администратором.')
    state = secrets.token_urlsafe(32)
    for key,value in list(OAUTH_STATES.items()):
        if time.time()-value['created'] > 600:
            del OAUTH_STATES[key]
    callback = PUBLIC_URL + '/archive/cloud/' + provider + '/callback'
    OAUTH_STATES[state] = {'user':user,'headers':headers,'provider':provider,'callback':callback,'created':time.time()}
    params = {'client_id':client_id,'redirect_uri':callback,'response_type':'code','state':state}
    if provider == 'google':
        params.update(scope='https://www.googleapis.com/auth/drive.file',access_type='offline',prompt='consent')
        endpoint = 'https://accounts.google.com/o/oauth2/v2/auth'
    else:
        params.update(scope='cloud_api:disk.write cloud_api:disk.info')
        endpoint = 'https://oauth.yandex.ru/authorize'
    return {'url':endpoint+'?'+urlencode(params)}


@router.get('/cloud/{provider}/callback')
async def cloud_callback(provider:str,state:str='',code:str='',error:str=''):
    saved = OAUTH_STATES.pop(state,None)
    if not saved or saved['provider'] != provider or time.time()-saved['created'] > 600:
        raise HTTPException(403,'Вход устарел. Повтори подключение диска из «Эд ПВЗ».')
    destination = 'https://edpvz.ru/apps/surveillance/ivideon.html'
    if error or not code:
        return RedirectResponse(destination+'#cloud=cancelled',303)
    client_id,secret = cloud_config(provider)
    token_url = 'https://oauth2.googleapis.com/token' if provider=='google' else 'https://oauth.yandex.ru/token'
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(token_url,data={'grant_type':'authorization_code','code':code,'client_id':client_id,'client_secret':secret,'redirect_uri':saved['callback']})
    if response.status_code != 200:
        return RedirectResponse(destination+'#cloud=failed',303)
    value = response.json()
    value['expires_at'] = time.time()+value.get('expires_in',3600)
    await cloud_data(saved['user'],saved['headers'],provider,value)
    return RedirectResponse(destination+'#cloud=connected',303)


@router.post('/cloud/{provider}/disconnect')
async def cloud_disconnect(provider:str,request:Request):
    cloud_config(provider)
    user,headers = await auth(request)
    await cloud_data(user,headers,provider,{})
    return {'connected':False}


async def cloud_token(provider,user,headers):
    value = await cloud_data(user,headers,provider)
    if not value.get('access_token'):
        raise HTTPException(409,'Сначала подключи диск.')
    if value.get('expires_at',0) < time.time()+120:
        if not value.get('refresh_token'):
            raise HTTPException(409,'Подключи диск заново: срок доступа истёк.')
        client_id,secret = cloud_config(provider)
        endpoint = 'https://oauth2.googleapis.com/token' if provider=='google' else 'https://oauth.yandex.ru/token'
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(endpoint,data={'grant_type':'refresh_token','refresh_token':value['refresh_token'],'client_id':client_id,'client_secret':secret})
        if response.status_code != 200:
            raise HTTPException(409,'Диск отклонил доступ. Подключи его заново.')
        value.update(response.json())
        value['expires_at'] = time.time()+value.get('expires_in',3600)
        await cloud_data(user,headers,provider,value)
    return value['access_token']


async def upload_cloud(provider,token,path,name,mime):
    async def file_bytes():
        with open(path,'rb') as source:
            while block := source.read(1024*1024):
                yield block
                await asyncio.sleep(0)
    size = Path(path).stat().st_size
    async with httpx.AsyncClient(timeout=120) as client:
        if provider=='yandex':
            headers = {'Authorization':'OAuth '+token}
            target = 'disk:/Эд ПВЗ/' + clean_name(name)
            folder = await client.put('https://cloud-api.yandex.net/v1/disk/resources',headers=headers,params={'path':'disk:/Эд ПВЗ'})
            if folder.status_code not in (201,409):
                raise HTTPException(502,'Не удалось создать папку на Яндекс Диске.')
            link = await client.get('https://cloud-api.yandex.net/v1/disk/resources/upload',headers=headers,params={'path':target,'overwrite':'false'})
            if link.status_code != 200:
                raise HTTPException(409,'Яндекс Диск отклонил файл. Проверь место и имя файла.')
            href = link.json().get('href','')
            parsed = urlparse(href)
            if parsed.scheme!='https' or not (parsed.hostname or '').endswith('.yandex.net'):
                raise HTTPException(502,'Некорректный ответ Яндекс Диска.')
            response = await client.put(href,headers={'Content-Length':str(size),'Content-Type':mime},content=file_bytes())
        else:
            response = await client.post('https://www.googleapis.com/upload/drive/v3/files',params={'uploadType':'resumable'},headers={'Authorization':'Bearer '+token,'X-Upload-Content-Type':mime,'X-Upload-Content-Length':str(size)},json={'name':name})
            href = response.headers.get('location','')
            parsed = urlparse(href)
            if response.status_code != 200 or parsed.scheme!='https' or parsed.hostname not in ('www.googleapis.com','content.googleapis.com'):
                raise HTTPException(502,'Google Диск не создал загрузку.')
            response = await client.put(href,headers={'Content-Length':str(size),'Content-Type':mime},content=file_bytes())
        if response.status_code not in (200,201,202):
            raise HTTPException(502,'Диск не подтвердил сохранение файла. Проверь свободное место.')
    return {'saved':True}


@router.post('/jobs/{job_id}/file/{file_id}/cloud/{provider}')
async def save_cloud(job_id:str,file_id:str,provider:str,request:Request):
    cloud_config(provider)
    user,headers = await auth(request)
    job = owned(job_id,user)
    item = next((f for f in job['files'] if f['id']==file_id),None)
    if not item or not item.get('path') or not Path(item['path']).is_file():
        raise HTTPException(404,'Файл недоступен.')
    lock = CLOUD_LOCKS.setdefault((user,provider),asyncio.Lock())
    async with lock:
        token = await cloud_token(provider,user,headers)
        return await upload_cloud(provider,token,item['path'],item['name'],item.get('mime','video/mp4'))


@router.post('/jobs/{job_id}/file/{file_id}/frame')
async def frame(job_id:str,file_id:str,request:Request):
    user,_ = await auth(request)
    job = owned(job_id,user)
    item = next((f for f in job['files'] if f['id']==file_id),None)
    data = await request.json()
    second = data.get('second')
    if not item or not item.get('path') or not isinstance(second,(int,float)) or not math.isfinite(second) or not 0 <= second < item.get('duration',0):
        raise HTTPException(400,'Выбери кадр внутри готовой записи.')
    output = ROOT/job_id/(file_id+'-frame-'+secrets.token_hex(4)+'.jpg')
    await process(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y','-ss',str(second),'-i',item['path'],'-frames:v','1','-q:v','2',str(output)],job,60)
    frame_id = 'frame-' + secrets.token_hex(8)
    job['files'].append({'id':frame_id,'path':str(output),'cameraId':item.get('cameraId'),'sourceStart':item.get('sourceStart',0)+int(second),'name':Path(item['name']).stem+'.jpg','size':output.stat().st_size,'duration':0,'width':item['width'],'height':item['height'],'mime':'image/jpeg'})
    return {'id':frame_id,'name':job['files'][-1]['name']}

