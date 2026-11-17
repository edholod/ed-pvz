import UpstreamWebSocket from 'npm:ws@8.23.0';

const origin = 'https://edpvz.ru';
const headers = {'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, range', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Cache-Control': 'no-store'};
const reply = (body: unknown, status = 200) => Response.json(body, {status, headers});
function secureStreamUrl(raw: string) {
  const url = new URL(raw);
  if (!['ws:', 'wss:', 'http:', 'https:'].includes(url.protocol) ||
      url.username || url.password ||
      !/(^|\.)(ivideon\.com|iv-cdn\.com|extcam\.com)$/.test(url.hostname)) return null;
  return new URL('wss:' + url.href.slice(url.protocol.length));
}
async function ticketKey(context = 'edpvz-ivideon-live:') {
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret) throw Error('Relay unavailable');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(context + secret));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function issueTicket(url: URL, expires = Date.now() + 30000, purpose = 'ws') {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify({url: url.href, expires, purpose}));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv}, await ticketKey(), plaintext));
  return btoa(Array.from([...iv,...cipher], (byte) => String.fromCharCode(byte)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function hlsTarget(raw: string, base?: string) {
  const url = new URL(raw, base);
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !/(^|\.)(ivideon\.com|iv-cdn\.com|extcam\.com)$/.test(url.hostname)) throw Error('Invalid HLS origin');
  return url;
}
async function hlsLink(url: URL, expires: number) {
  const link = new URL(Deno.env.get('SUPABASE_URL') + '/functions/v1/edpvz-ivideon-check');
  link.searchParams.set('hls', await issueTicket(url, expires, 'hls'));
  return link.href;
}
async function serveHls(req: Request, ticket: string) {
  try {
    if (!/^[a-zA-Z0-9_-]{40,12000}$/.test(ticket)) throw Error();
    const bytes = Uint8Array.from(atob(ticket.replace(/-/g,'+').replace(/_/g,'/')), (char) => char.charCodeAt(0));
    const plain = await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12)}, await ticketKey(), bytes.slice(12));
    const {url, expires, purpose} = JSON.parse(new TextDecoder().decode(plain));
    if (purpose !== 'hls' || typeof expires !== 'number' || expires < Date.now()) throw Error();
    let target = hlsTarget(url);
    let response: Response | undefined;
    const requestHeaders = new Headers();
    const range = req.headers.get('range');
    if (range && /^bytes=\d+-\d*$/.test(range)) requestHeaders.set('range',range);
    const deadline = AbortSignal.timeout(12000);
    for (let i = 0; i < 4; i++) {
      response = await fetch(target, {redirect:'manual', headers:requestHeaders, signal:deadline});
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw Error();
      target = hlsTarget(location, target.href);
    }
    if (!response?.ok) return reply({error:'Ivideon не отдал данные HLS.'}, 502);
    const contentType = response.headers.get('content-type') ?? '';
    const headersOut = {...headers, 'Access-Control-Expose-Headers':'Content-Range, Accept-Ranges', 'X-Content-Type-Options':'nosniff'};
    if (/mpegurl/i.test(contentType) || /\.m3u8$/i.test(target.pathname) || /text\/plain/i.test(contentType)) {
      const manifest = await response.text();
      if (manifest.length > 512000 || !manifest.startsWith('#EXTM3U')) throw Error();
      const links = new Map<string, Promise<string>>();
      const wrap = (value: string) => {
        const next = hlsTarget(value, target.href);
        if (!links.has(next.href)) links.set(next.href, hlsLink(next, expires));
        return links.get(next.href)!;
      };
      const lines = await Promise.all(manifest.split(/\r?\n/).map(async (line) => {
        if (!line.trim()) return line;
        if (!line.startsWith('#')) return wrap(line.trim());
        for (const match of line.matchAll(/\bURI="([^"]+)"/g)) {
          line = line.replace(match[0], 'URI="' + await wrap(match[1]) + '"');
        }
        return line;
      }));
      return new Response(lines.join('\n'), {headers:{...headersOut,'Content-Type':'application/vnd.apple.mpegurl'}});
    }
    const media = new Headers(headersOut);
    media.set('Content-Type', /^(video\/|audio\/|application\/octet-stream)/i.test(contentType) ? contentType : 'application/octet-stream');
    for (const name of ['Content-Range','Accept-Ranges']) {
      const value = response.headers.get(name);
      if (value) media.set(name,value);
    }
    return new Response(response.body, {status:response.status, headers:media});
  } catch {
    return reply({error:'Не удалось получить сегмент HLS Ivideon.'}, 502);
  }
}
async function relay(req: Request, ticket: string) {
  let upstreamUrl;
  try {
    if (!/^[a-zA-Z0-9_-]{40,12000}$/.test(ticket)) throw Error();
    const bytes = Uint8Array.from(atob(ticket.replace(/-/g,'+').replace(/_/g,'/')), (char) => char.charCodeAt(0));
    const plain = await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12)}, await ticketKey(), bytes.slice(12));
    const {url, expires, purpose} = JSON.parse(new TextDecoder().decode(plain));
    if ((purpose && purpose !== 'ws') || typeof expires !== 'number' || expires < Date.now() || !(upstreamUrl = secureStreamUrl(url))) throw Error();
  } catch {
    return reply({error:'Ссылка на эфир истекла.'}, 403);
  }
  const {socket, response} = Deno.upgradeWebSocket(req);
  const textTransport = new URL(req.url).searchParams.get('frames') === 'text';
  let upstream: UpstreamWebSocket | undefined;
  let binaryFrames = 0, textFrames = 0, reported = false;
  const messages = {init:0, metadata:0, fragment:0, inline:0, error:0, other:0};
  const report = () => {
    if (reported) return;
    reported = true;
    console.info('ivideon-relay frames text=' + textFrames + ' binary=' + binaryFrames + ' ' + JSON.stringify(messages) + ' transport=ws');
  };
  const end = () => {
    report();
    if (upstream && upstream.readyState < UpstreamWebSocket.CLOSING) upstream.terminate();
    if (socket.readyState === WebSocket.OPEN) socket.close();
  };
  socket.onclose = end;
  socket.onerror = end;
  socket.onopen = () => {
    try {
      upstream = new UpstreamWebSocket(upstreamUrl.href, {
        perMessageDeflate: false,
        handshakeTimeout: 8000,
        maxPayload: 12 * 1024 * 1024,
      });
      upstream.binaryType = 'nodebuffer';
      upstream.on('message', (data, isBinary) => {
        if (socket.readyState !== WebSocket.OPEN) return end();
        if (Array.isArray(data) || !(data instanceof Uint8Array)) return end();
        if (socket.bufferedAmount + Math.ceil(data.byteLength * (textTransport && isBinary ? 4 / 3 : 1)) > 16 * 1024 * 1024) return end();
        try {
          if (isBinary) {
            binaryFrames++;
            socket.send(textTransport ? 'edpvz-fmp4:' + data.toString('base64') : data);
            return;
          }
          textFrames++;
          const message = data.toString('utf8');
          try {
            const msg = JSON.parse(message);
            switch (msg?.type) {
              case 'stream-init': messages.init++; break;
              case 'metadata': messages.metadata++; break;
              case 'fragment':
                messages.fragment++;
                if (typeof msg.data === 'string' && msg.data.length) messages.inline++;
                break;
              case 'error': case 'stream-error': messages.error++; break;
              default: messages.other++;
            }
          } catch { messages.other++; }
          socket.send(message);
        } catch { end(); }
      });
      upstream.on('error', end);
      upstream.on('close', end);
    } catch { end(); }
  };
  return response;
}

async function connectionCipher(userId: string, value: string, encrypt: boolean) {
  const cipher = await ticketKey('edpvz-ivideon-connection-v1:');
  const additionalData = new TextEncoder().encode(userId);
  if (encrypt) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
      {name:'AES-GCM', iv, additionalData}, cipher, new TextEncoder().encode(value),
    ));
    return btoa(String.fromCharCode(...iv, ...ciphertext));
  }
  const bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0));
  const result = await crypto.subtle.decrypt(
    {name:'AES-GCM', iv:bytes.slice(0,12), additionalData}, cipher, bytes.slice(12),
  );
  return new TextDecoder().decode(result);
}

async function connectionRequest(userId: string, method: string, encryptedKey?: string) {
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret) throw Error('Connection storage unavailable');
  const endpoint = new URL(Deno.env.get('SUPABASE_URL') + '/rest/v1/edpvz_ivideon_connections');
  if (method === 'POST') endpoint.searchParams.set('on_conflict','user_id');
  else endpoint.searchParams.set('user_id','eq.' + userId);
  if (method === 'GET') endpoint.searchParams.set('select','encrypted_key');
  const response = await fetch(endpoint, {method, headers:{
    apikey:secret, authorization:'Bearer ' + secret, 'content-type':'application/json',
    ...(method === 'POST' ? {Prefer:'resolution=merge-duplicates,return=minimal'} : {}),
  }, body:method === 'POST' ? JSON.stringify({
    user_id:userId, encrypted_key:encryptedKey, updated_at:new Date().toISOString(),
  }) : undefined, signal:AbortSignal.timeout(3500)});
  if (!response.ok) throw Error('Connection storage unavailable');
  return method === 'GET' ? (await response.json())[0]?.encrypted_key ?? null : null;
}

Deno.serve(async (req) => {
  const requestOrigin = req.headers.get('origin');
  const nativeMedia = req.method === 'GET' && !requestOrigin &&
    new URL(req.url).searchParams.has('hls') &&
    req.headers.get('referer') === origin + '/';
  if (requestOrigin !== origin && !nativeMedia) return reply({error:'Доступ запрещён'}, 403);
  if (req.method === 'GET' && req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
    return relay(req, new URL(req.url).searchParams.get('ticket') ?? '');
  }
  if (req.method === 'GET') return serveHls(req, new URL(req.url).searchParams.get('hls') ?? '');
  if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers});
  if (req.method !== 'POST') return reply({error:'Метод недоступен'}, 405);
  const authorization = req.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return reply({error:'Войдите в Эд ПВЗ'}, 401);
  try {
    const session = await fetch(Deno.env.get('SUPABASE_URL') + '/rest/v1/rpc/edpvz_ivideon_allowed', {
      method:'POST', headers:{authorization, apikey: Deno.env.get('SUPABASE_ANON_KEY')!, 'content-type':'application/json'},
      body:'{}', signal:AbortSignal.timeout(5000)
    });
    if (!session.ok || await session.json() !== true) return reply({error:'Доступ запрещён'}, 403);
    const raw = await req.text();
    if (raw.length > 2048) return reply({error:'Некорректный запрос'}, 400);
    let payload;
    try { payload = JSON.parse(raw); } catch { return reply({error:'Некорректный запрос'}, 400); }
    const {cameraId, quality, action, archive} = payload ?? {};
    let {key} = payload ?? {};
    let userId;
    if (action !== undefined) {
      if (!['save','load','disconnect'].includes(action) ||
          (action !== 'load' && cameraId !== undefined)) {
        return reply({error:'Некорректное действие Ivideon'}, 400);
      }
      const identity = await fetch(Deno.env.get('SUPABASE_URL') + '/auth/v1/user', {
        headers:{authorization, apikey:Deno.env.get('SUPABASE_ANON_KEY')!},
        signal:AbortSignal.timeout(3500),
      });
      if (!identity.ok) return reply({error:'Войдите в Эд ПВЗ'}, 401);
      userId = (await identity.json())?.id;
      if (typeof userId !== 'string' || !/^[a-f0-9-]{36}$/i.test(userId)) return reply({error:'Войдите в Эд ПВЗ'}, 401);
      if (action === 'disconnect') {
        await connectionRequest(userId, 'DELETE');
        return reply({connected:false});
      }
      if (action === 'load') {
        const encrypted = await connectionRequest(userId, 'GET');
        if (!encrypted) return cameraId === undefined ? reply({connected:false,cameras:[]}) : reply({error:'Подключите Ivideon к аккаунту.'}, 409);
        key = await connectionCipher(userId, encrypted, false);
      }
    }
    if (typeof key !== 'string' || !/^xtok-[a-zA-Z0-9_.~+/=\-]{8,512}$/.test(key)) return reply({error:'Нужен ключ Ivideon формата xtok-…'}, 400);
    const deadline = AbortSignal.timeout(8500);
    if (cameraId !== undefined) {
      if (typeof cameraId !== 'string' || !/^[a-zA-Z0-9_-]{1,120}:[0-9]{1,8}$/.test(cameraId)) {
        return reply({error:'Некорректный ID камеры Ivideon.'}, 400);
      }
      if (archive?.mode === 'export-status') {
        if (action !== 'load' || typeof archive.exportId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(archive.exportId)) {
          return reply({error:'Некорректный запрос экспорта.'},400);
        }
        const endpoint = new URL('https://openapi-alpha.ivideon.com/exported_records');
        endpoint.search = new URLSearchParams({op:'FIND',access_token:key}).toString();
        const response = await fetch(endpoint,{method:'POST',redirect:'error',signal:deadline,
          headers:{'content-type':'application/json'},body:JSON.stringify({limit:100,skip:0,sources:[{id:cameraId,type:'camera'}]})});
        const data = await response.json().catch(() => null);
        if (!response.ok || data?.success !== true || !Array.isArray(data?.result?.items)) {
          return reply({error:'Ivideon не вернул состояние экспорта (HTTP ' + response.status + ').'},502);
        }
        const record = data.result.items.find((item) => String(item?.id) === archive.exportId);
        if (!record) return reply({state:'pending'});
        if (record.status === 'ready' && typeof record.video_url === 'string') {
          const download = hlsTarget(record.video_url);
          if (decodeURIComponent(download.href).includes(key)) return reply({error:'Ivideon вернул ссылку с ключом аккаунта. Файл доступен в кабинете Ivideon.'},422);
          return reply({state:'ready',downloadUrl:download.href});
        }
        if (['failed','error','cancelled','expired','deleted'].includes(record.status)) return reply({state:'failed'});
        const progress = Number(record.progress);
        return reply({state:'pending',progress:Number.isFinite(progress) ? Math.min(100,Math.max(0,Math.round(progress))) : null});
      }
      if (archive !== undefined) {
        const start = archive?.start;
        const end = archive?.end;
        const now = Math.floor(Date.now()/1000);
        if (action !== 'load' || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
            start <= 0 || start >= now || end <= start || end > now + 30 || end - start > 3600) {
          return reply({error:'Укажи прошедшее время и интервал до одного часа.'}, 400);
        }
        if (archive.mode === 'export') {
          const endpoint = new URL('https://openapi-alpha.ivideon.com/cameras/' + cameraId + '/archive');
          endpoint.search = new URLSearchParams({op:'EXPORT',access_token:key}).toString();
          const response = await fetch(endpoint,{method:'POST',redirect:'error',signal:deadline,
            headers:{'content-type':'application/json'},body:JSON.stringify({start_time:start,end_time:end})});
          const data = await response.json().catch(() => null);
          const id = data?.result?.id == null ? '' : String(data.result.id);
          if (!response.ok || data?.success !== true || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(id)) {
            const code = typeof data?.code === 'string' && /^[A-Z0-9_]{1,60}$/.test(data.code) ? ' · ' + data.code : '';
            return reply({error:'Ivideon не начал экспорт (HTTP ' + response.status + code + '). Попробуй другой интервал или проверь доступ к экспорту.'},422);
          }
          return reply({exportId:id});
        }
        let status = 0;
        for (const profile of ['1','2']) {
          const endpoint = new URL('https://openapi-alpha.ivideon.com/cameras/' + cameraId + '/archive_stream');
          endpoint.search = new URLSearchParams({
            op:'GET',access_token:key,format:'hls',q:profile,start_time:String(start),end_time:String(end),
          }).toString();
          const response = await fetch(endpoint,{redirect:'manual',signal:deadline});
          status = response.status;
          if (status === 401 || status === 403) return reply({error:'Ключ Ivideon не даёт доступа к архиву этой камеры.'},422);
          const location = response.headers.get('location');
          const data = location ? null : await response.json().catch(() => null);
          const target = location ?? (data?.success === true ? data?.result?.url : null);
          if (typeof target !== 'string') continue;
          const url = hlsTarget(target,endpoint.href);
          const streamUrl = decodeURIComponent(url.href).includes(key) ? await hlsLink(url,Date.now()+15*60*1000) : url.href;
          return reply({streamType:'hls',streamUrl});
        }
        return reply({error:'Ivideon не выдал запись за этот период (HTTP ' + status + '). Проверь другой интервал.'},422);
      }
      const endpoint = new URL('https://openapi-alpha.ivideon.com/cameras/' + cameraId + '/live_stream');
      endpoint.search = new URLSearchParams({
        op:'GET', access_token:key, q:quality === 1 ? '1' : '2', video_codecs:'h264',
        ...(quality === 1 ? {} : {audio_codecs:'none'}), format:'ws-fmp4',
      }).toString();
      if (quality === 'hls' || quality === 1) {
        try {
          const hls = new URL(endpoint.href);
          hls.searchParams.set('format', 'hls');
          hls.searchParams.set('q', quality === 1 ? '2' : '1');
          hls.searchParams.delete('audio_codecs');
          hls.searchParams.delete('video_codecs');
          const res = await fetch(hls, {redirect:'manual', signal:AbortSignal.timeout(3500)});
          const location = res.headers.get('location');
          const data = location ? null : await res.json().catch(() => null);
          const target = location ?? (data?.success === true ? data?.result?.url : null);
          if (typeof target === 'string') {
            const url = hlsTarget(target, hls.href);
            const streamUrl = decodeURIComponent(url.href).includes(key) ? await hlsLink(url, Date.now() + 15 * 60 * 1000) : url.href;
            return reply({streamUrl, streamType:'hls'});
          }
        } catch { /* Fall through to the WebSocket stream. */ }
      }
      const upstream = await fetch(endpoint, {redirect:'error', signal:deadline});
      const stream = await upstream.json().catch(() => null);
      if (!upstream.ok || stream?.success !== true || typeof stream?.result?.url !== 'string') {
        return reply({error:'Ivideon не открыл эфир камеры (HTTP ' + upstream.status + ').'}, 422);
      }
      const url = secureStreamUrl(stream.result.url);
      if (!url) {
        return reply({error:'Ivideon вернул адрес с неподдерживаемым протоколом или доменом видеосервера.'}, 422);
      }
      const decoded = decodeURIComponent(url.href);
      if (decoded.includes(key) || /xtok-/i.test(decoded)) {
        const relayUrl = new URL(Deno.env.get('SUPABASE_URL') + '/functions/v1/edpvz-ivideon-check');
        relayUrl.protocol = 'wss:';
        relayUrl.searchParams.set('ticket', await issueTicket(url));
        return reply({streamUrl:relayUrl.href});
      }
      return reply({streamUrl:url.href});
    }
    const statuses: string[] = [];
    for (const resource of ['cameras', 'servers']) {
      const url = new URL('https://openapi-alpha.ivideon.com/' + resource);
      url.search = new URLSearchParams({op:'FIND', access_token:key}).toString();
      const response = await fetch(url, {
        method:'POST', redirect:'error', signal:deadline,
        headers:{'content-type':'application/json', accept:'application/json'},
        body:JSON.stringify({limit:100, skip:0}),
      });
      statuses.push(resource + ': HTTP ' + response.status);
      if (!response.ok) continue;
      const data = await response.json().catch(() => null);
      const items = Array.isArray(data?.result) ? data.result : data?.result?.items ?? data?.result?.cameras;
      if (data?.success !== true || !Array.isArray(items)) continue;
      const list = resource === 'servers'
        ? items.flatMap((server) => Array.isArray(server?.cameras) ? server.cameras : [])
        : items;
      if (resource === 'servers' && items.length && !items.some((server) => Array.isArray(server?.cameras))) continue;
      if (action === 'save') await connectionRequest(userId, 'POST', await connectionCipher(userId, key, true));
      return reply({connected:action !== undefined,cameras:list.slice(0,250).map((item) => ({
        id: typeof item?.id === 'string' && /^[a-zA-Z0-9_-]{1,120}:[0-9]{1,8}$/.test(item.id) ? item.id : null,
        name: typeof item?.name === 'string' ? item.name.slice(0,160) : 'Камера Ivideon',
      }))});
    }
    return reply({error:'Ivideon не подтвердил получение камер (' + statuses.join(', ') + ').'}, 422);
  } catch {
    return reply({error:'Не удалось завершить проверку Ivideon. Повторите позже.'}, 502);
  }
});
