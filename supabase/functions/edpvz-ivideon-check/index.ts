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
async function issueTicket(url: URL, expires = Date.now() + 30000, purpose = 'ws', grant?:MediaGrant) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify({url: url.href, expires, purpose, grant}));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv}, await ticketKey(), plaintext));
  return btoa(Array.from([...iv,...cipher], (byte) => String.fromCharCode(byte)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function hlsTarget(raw: string, base?: string) {
  const url = new URL(raw, base);
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !/(^|\.)(ivideon\.com|iv-cdn\.com|extcam\.com)$/.test(url.hostname)) throw Error('Invalid HLS origin');
  return url;
}
async function hlsLink(url: URL, expires: number, grant?:MediaGrant) {
  const link = new URL(Deno.env.get('SUPABASE_URL') + '/functions/v1/edpvz-ivideon-check');
  link.searchParams.set('hls', await issueTicket(url, expires, 'hls', grant));
  return link.href;
}
async function serveHls(req: Request, ticket: string) {
  try {
    if (!/^[a-zA-Z0-9_-]{40,12000}$/.test(ticket)) throw Error();
    const bytes = Uint8Array.from(atob(ticket.replace(/-/g,'+').replace(/_/g,'/')), (char) => char.charCodeAt(0));
    const plain = await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12)}, await ticketKey(), bytes.slice(12));
    const {url, expires, purpose, grant} = JSON.parse(new TextDecoder().decode(plain));
    const download = new URL(req.url).searchParams.has('download');
    if (!(download ? ['download','browser-download'].includes(purpose) : purpose === 'hls') || typeof expires !== 'number' || expires < Date.now()) throw Error();
    if (grant && !await grantActive(grant)) throw Error();
    let target = hlsTarget(url);
    const providerKey = target.searchParams.get('access_token');
    let response: Response | undefined;
    const requestHeaders = new Headers();
    const range = req.headers.get('range');
    if (range && /^bytes=\d+-\d*$/.test(range)) requestHeaders.set('range',range);
    const bounded = download && range !== null && /^bytes=\d+-\d+$/.test(range);
    const deadline = AbortSignal.timeout(bounded ? 12000 : download ? 120000 : 12000);
    for (let i = 0; i < 4; i++) {
      response = await fetch(target, {redirect:'manual', headers:requestHeaders, signal:deadline});
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw Error();
      target = hlsTarget(location, target.href);
      if (purpose === 'browser-download' && providerKey &&
          /^rr\d+\.extcam\.com$/.test(target.hostname) &&
          !target.searchParams.has('access_token') &&
          !decodeURIComponent(target.href).includes(providerKey)) {
        return new Response(null,{status:302,headers:{...headers,Location:target.href,'Referrer-Policy':'no-referrer'}});
      }
    }
    if (!response?.ok) return reply({error:download ? 'Ivideon не отдал файл. Подготовь MP4 заново.' : 'Ivideon не отдал данные HLS.'}, 502);
    const contentType = response.headers.get('content-type') ?? '';
    const headersOut = {...headers, 'Access-Control-Expose-Headers':'Content-Range, Accept-Ranges', 'X-Content-Type-Options':'nosniff'};
    if (download) {
      if (!/^(video\/mp4|application\/octet-stream)/i.test(contentType)) return reply({error:'Ivideon не вернул файл MP4.'},502);
      const fileHeaders = new Headers(headersOut);
      fileHeaders.set('Content-Type','video/mp4');
      fileHeaders.set('Content-Disposition','attachment; filename="ivideon-archive.mp4"');
      for (const name of ['Content-Range','Accept-Ranges','Content-Length']) {
        const value = response.headers.get(name);
        if (value) fileHeaders.set(name,value);
      }
      if (bounded) {
        const length = Number(response.headers.get('Content-Length'));
        if (response.status !== 206 || !Number.isSafeInteger(length) || length < 1 || length > 65536) {
          await response.body?.cancel();
          return reply({error:'Ivideon не вернул запрошенную часть файла.'},502);
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        if (!response.body) return reply({error:'Ivideon вернул пустой ответ.'},502);
        for await (const block of response.body) {
          if (offset + block.length > length) return reply({error:'Ivideon вернул лишние байты.'},502);
          bytes.set(block,offset);
          offset += block.length;
        }
        if (offset !== length) return reply({error:'Ivideon передал неполную часть файла.'},502);
        return new Response(bytes,{status:206,headers:fileHeaders});
      }
      return new Response(response.body,{status:response.status,headers:fileHeaders});
    }
    if (/mpegurl/i.test(contentType) || /\.m3u8$/i.test(target.pathname) || /text\/plain/i.test(contentType)) {
      const manifest = await response.text();
      if (manifest.length > 512000 || !manifest.startsWith('#EXTM3U')) throw Error();
      const links = new Map<string, Promise<string>>();
      const wrap = (value: string) => {
        const next = hlsTarget(value, target.href);
        if (!links.has(next.href)) links.set(next.href, hlsLink(next, expires, grant));
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
  let connectionGrant: MediaGrant | undefined;
  try {
    if (!/^[a-zA-Z0-9_-]{40,12000}$/.test(ticket)) throw Error();
    const bytes = Uint8Array.from(atob(ticket.replace(/-/g,'+').replace(/_/g,'/')), (char) => char.charCodeAt(0));
    const plain = await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12)}, await ticketKey(), bytes.slice(12));
    const {url, expires, purpose} = JSON.parse(new TextDecoder().decode(plain));
    if ((purpose && purpose !== 'ws') || typeof expires !== 'number' || expires < Date.now() || !(upstreamUrl = secureStreamUrl(url))) throw Error();
    if (grant && !await grantActive(grant)) throw Error();
    connectionGrant = grant;
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
  const recheck = connectionGrant ? setInterval(() => {
    void grantActive(connectionGrant!).then(active => { if (!active) end(); }).catch(end);
  }, 15000) : undefined;
  const end = () => {
    if (recheck !== undefined) clearInterval(recheck);
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

async function extraConnections(userId: string, id?: string, method = 'GET', data?: object) {
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret) throw Error('Connection storage unavailable');
  const endpoint = new URL(Deno.env.get('SUPABASE_URL') + '/rest/v1/edpvz_ivideon_extra_connections');
  if (method !== 'POST') {
    endpoint.searchParams.set('user_id', 'eq.' + userId);
    if (id) endpoint.searchParams.set('id', 'eq.' + id);
  }
  if (method === 'GET') endpoint.searchParams.set('select', id ? 'encrypted_key,label' : 'id,label');
  const response = await fetch(endpoint, {method, headers:{
    apikey:secret, authorization:'Bearer ' + secret, 'content-type':'application/json',
  }, body:data ? JSON.stringify(data) : undefined, signal:AbortSignal.timeout(3500)});
  if (!response.ok) throw Error('Connection storage unavailable');
  return method === 'GET' ? await response.json() : [];
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

type CameraPermission = 'can_live' | 'can_archive' | 'can_download' | 'can_edit';
type MediaGrant = {id:string, permission:CameraPermission};
const validId = (id:unknown): id is string => typeof id === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id);
const validCamera = (id:unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,120}:[0-9]{1,8}$/.test(id);
const permissions = ['can_live','can_archive','can_download','can_edit'] as const;

async function serviceRows(table:string, filters:Record<string,string>, method='GET', data?:object) {
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret) throw Error('Service unavailable');
  const url = new URL(Deno.env.get('SUPABASE_URL') + '/rest/v1/' + table);
  url.search = new URLSearchParams(filters).toString();
  const response = await fetch(url,{method,headers:{
    apikey:secret, authorization:'Bearer ' + secret, 'content-type':'application/json',
    Prefer:'resolution=merge-duplicates,return=representation',
  },body:data ? JSON.stringify(data) : undefined,signal:AbortSignal.timeout(5000)});
  if (!response.ok) throw Error('Share storage unavailable');
  return response.status === 204 ? [] : await response.json();
}
const sharesTable = 'edpvz_ivideon_camera_shares';
const exportsTable = 'edpvz_ivideon_shared_exports';

async function grantActive(grant:MediaGrant) {
  if (!validId(grant.id) || !permissions.includes(grant.permission)) return false;
  const [row] = await serviceRows(sharesTable,{id:'eq.'+grant.id,select:grant.permission});
  return row?.[grant.permission] === true;
}
async function cameraKey(owner:string, connection?:string) {
  const encrypted = connection ? (await extraConnections(owner,connection))[0]?.encrypted_key
    : await connectionRequest(owner,'GET');
  return encrypted ? await connectionCipher(owner,encrypted,false) : null;
}
async function findCamera(key:string, id:string) {
  for (const resource of ['cameras','servers']) {
    const url = new URL('https://openapi-alpha.ivideon.com/' + resource);
    url.search = new URLSearchParams({op:'FIND',access_token:key}).toString();
    const response = await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),
      headers:{'content-type':'application/json'},body:JSON.stringify({limit:100,skip:0})});
    if (!response.ok) continue;
    const data = await response.json();
    const items = Array.isArray(data?.result) ? data.result : data?.result?.items ?? data?.result?.cameras;
    if (data?.success !== true || !Array.isArray(items)) continue;
    const cameras = resource === 'cameras' ? items : items.flatMap(server=>server?.cameras || []);
    const camera = cameras.find(item=>item?.id===id);
    if (camera) return String(camera.name || 'Камера Ivideon').slice(0,160);
  }
  return null;
}
async function sharedAction(action:string, user:string, options:Record<string,any>, cameraId:unknown, connectionId?:string) {
  if (action === 'shared-list') {
    const rows = await serviceRows(sharesTable,{recipient_id:'eq.'+user,select:'id,owner_id,camera_id,camera_name,can_live,can_archive,can_download,can_edit'});
    const cameras = await Promise.all(rows.map(async (row:any)=>{
      const [setting] = await serviceRows('edpvz_ivideon_camera_settings',{user_id:'eq.'+row.owner_id,camera_id:'eq.'+row.camera_id,select:'display_name'});
      return {id:row.id,name:setting?.display_name || row.camera_name,
        can_live:row.can_live,can_archive:row.can_archive,can_download:row.can_download,can_edit:row.can_edit};
    }));
    return reply({cameras});
  }
  if (action === 'share-list') {
    if (!validCamera(cameraId)) return reply({error:'Некорректная камера.'},400);
    const rows = await serviceRows(sharesTable,{owner_id:'eq.'+user,camera_id:'eq.'+cameraId,select:'id,recipient_id,can_live,can_archive,can_download,can_edit'});
    return reply({shares:await Promise.all(rows.map(async (row:any)=>{
      const [profile] = await serviceRows('edpvz_profiles',{user_id:'eq.'+row.recipient_id,select:'username'});
      return {id:row.id,username:profile?.username || 'Пользователь',
        can_live:row.can_live,can_archive:row.can_archive,can_download:row.can_download,can_edit:row.can_edit};
    }))});
  }
  if (action === 'share-revoke') {
    if (!validId(options.shareId)) return reply({error:'Некорректный доступ.'},400);
    await serviceRows(sharesTable,{id:'eq.'+options.shareId,owner_id:'eq.'+user},'DELETE');
    return reply({ok:true});
  }
  if (action === 'share-save') {
    const username = typeof options.username === 'string' ? options.username.trim().replace(/^@/,'').toLowerCase() : '';
    if (!validCamera(cameraId) || !/^[a-z0-9_]{2,32}$/.test(username) || !permissions.some(p=>options[p]===true))
      return reply({error:'Укажи пользователя и хотя бы одно разрешение.'},400);
    const [profile] = await serviceRows('edpvz_profiles',{username:'eq.'+username,select:'user_id'});
    if (!profile || profile.user_id === user) return reply({error:'Укажи логин другого пользователя «Эд ПВЗ».'},400);
    const key = await cameraKey(user,connectionId);
    const name = key && await findCamera(key,cameraId);
    if (!name) return reply({error:'Камера недоступна в выбранном аккаунте Ivideon.'},404);
    await serviceRows(sharesTable,{on_conflict:'owner_id,recipient_id,camera_id'},'POST',{
      owner_id:user,recipient_id:profile.user_id,camera_id:cameraId,connection_id:connectionId ?? null,camera_name:name,
      ...Object.fromEntries(permissions.map(p=>[p,options[p]===true])),
    });
    return reply({ok:true});
  }
  if (action !== 'shared-edit') return null;
  if (!validId(options.shareId)) return reply({error:'Некорректный доступ.'},400);
  const [row] = await serviceRows(sharesTable,{id:'eq.'+options.shareId,recipient_id:'eq.'+user,can_edit:'eq.true'});
  if (!row) return reply({error:'Редактирование камеры запрещено.'},403);
  const points = await serviceRows('edpvz_points',{owner_id:'eq.'+row.owner_id,select:'point_id,name',order:'name.asc'});
  const [setting] = await serviceRows('edpvz_ivideon_camera_settings',{user_id:'eq.'+row.owner_id,camera_id:'eq.'+row.camera_id,select:'display_name,point_id'});
  if (options.displayName === undefined) return reply({points, displayName:setting?.display_name || '', pointId:setting?.point_id || ''});
  const name = typeof options.displayName === 'string' ? options.displayName.trim() : null;
  const point = options.pointId || null;
  if (name === null || name.length > 100 || (point && !points.some((p:any)=>p.point_id===point)))
    return reply({error:'Проверь название и пункт выдачи.'},400);
  await serviceRows('edpvz_ivideon_camera_settings',{on_conflict:'user_id,camera_id'},'POST',{
    user_id:row.owner_id,camera_id:row.camera_id,display_name:name,point_id:point,
  });
  return reply({ok:true});
}

Deno.serve(async (req) => {
  const requestOrigin = req.headers.get('origin');
  const nativeMedia = req.method === 'GET' && !requestOrigin &&
    new URL(req.url).searchParams.has('hls') &&
    req.headers.get('referer') === origin + '/';
  const downloadTicket = req.method === 'GET' ? new URL(req.url).searchParams.get('download') : null;
  if (downloadTicket && (!requestOrigin || requestOrigin === origin)) return serveHls(req, downloadTicket);
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
    const raw = await req.text();
    if (raw.length > 2048) return reply({error:'Некорректный запрос'}, 400);
    let payload;
    try { payload = JSON.parse(raw); } catch { return reply({error:'Некорректный запрос'}, 400); }
    let {cameraId} = payload ?? {};
    const {quality, action} = payload ?? {};
    const incoming = ['shared-list','shared-use','shared-edit'].includes(action);
    const managing = ['share-save','share-list','share-revoke'].includes(action);
    if (!incoming) {
    const session = await fetch(Deno.env.get('SUPABASE_URL') + '/rest/v1/rpc/edpvz_ivideon_allowed', {
      method:'POST', headers:{authorization, apikey: Deno.env.get('SUPABASE_ANON_KEY')!, 'content-type':'application/json'},
      body:'{}', signal:AbortSignal.timeout(5000)
    });
    if (!session.ok || await session.json() !== true) return reply({error:'Доступ запрещён'}, 403);
    }
    const {connectionId, accountLabel, shareId, ...options} = payload?.archive ?? {};
    const archive = Object.keys(options).length ? options : undefined;
    if (connectionId !== undefined && (typeof connectionId !== 'string' || !/^[a-f0-9-]{36}$/i.test(connectionId))) return reply({error:'Некорректное подключение Ivideon.'},400);
    let {key} = payload ?? {};
    let userId;
    let mediaGrant:MediaGrant | undefined;
    if (action !== undefined) {
      if ((!incoming && !managing && !['save','add','accounts','load','disconnect'].includes(action)) ||
          (!incoming && !managing && action !== 'load' && cameraId !== undefined)) {
        return reply({error:'Некорректное действие Ivideon'}, 400);
      }
      const identity = await fetch(Deno.env.get('SUPABASE_URL') + '/auth/v1/user', {
        headers:{authorization, apikey:Deno.env.get('SUPABASE_ANON_KEY')!},
        signal:AbortSignal.timeout(3500),
      });
      if (!identity.ok) return reply({error:'Войдите в Эд ПВЗ'}, 401);
      userId = (await identity.json())?.id;
      if (typeof userId !== 'string' || !/^[a-f0-9-]{36}$/i.test(userId)) return reply({error:'Войдите в Эд ПВЗ'}, 401);
      if (managing || action === 'shared-list' || action === 'shared-edit') {
        return await sharedAction(action,userId,{...options,shareId},cameraId,connectionId);
      }
      if (action === 'shared-use') {
        if (!validId(shareId)) return reply({error:'Некорректный доступ.'},400);
        const [row] = await serviceRows(sharesTable,{id:'eq.'+shareId,recipient_id:'eq.'+userId});
        const mode = archive?.mode;
        const permission = mode === 'export' || mode === 'export-status' ? 'can_download'
          : mode === 'preview' ? 'can_archive' : !archive ? 'can_live' : null;
        if (!row || !permission || !row[permission]) return reply({error:'Это действие запрещено владельцем камеры.'},403);
        if (mode === 'export-status') {
          if (typeof archive.exportId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(archive.exportId))
            return reply({error:'Некорректный экспорт.'},400);
          const [exportRecord] = await serviceRows(exportsTable,{share_id:'eq.'+shareId,export_id:'eq.'+archive.exportId,select:'export_id'});
          if (!exportRecord) return reply({error:'Этот экспорт недоступен.'},403);
        }
        if (archive) {
          archive.ingest = false;
          archive.share = false;
          archive.browserDownload = false;
        }
        cameraId = row.camera_id;
        key = await cameraKey(row.owner_id,row.connection_id);
        if (!key) return reply({error:'Владелец отключил аккаунт Ivideon.'},409);
        mediaGrant = {id:shareId,permission};
      }
      if (action === 'accounts') {
        return reply({accounts:await extraConnections(userId)});
      }
      if (action === 'add' && (typeof accountLabel !== 'string' || !accountLabel.trim() || accountLabel.trim().length > 80)) {
        return reply({error:'Укажи название аккаунта Ivideon.'},400);
      }
      if (action === 'disconnect') {
        if (connectionId) await extraConnections(userId, connectionId, 'DELETE');
        else await connectionRequest(userId, 'DELETE');
        return reply({connected:false});
      }
      if (action === 'load') {
        const encrypted = connectionId ? (await extraConnections(userId, connectionId))[0]?.encrypted_key : await connectionRequest(userId, 'GET');
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
        if ((!mediaGrant && action !== 'load') || typeof archive.exportId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(archive.exportId)) {
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
          download.searchParams.set('access_token',key);
          if (archive.ingest === true) {
            // Bind the server-ingestion envelope to this authenticated request.
            // Never return the provider API key as a plaintext media URL.
            const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('edpvz-archive-ingest:'+authorization));
            const cipherKey=await crypto.subtle.importKey('raw',digest,'AES-GCM',false,['encrypt']);
            const iv=crypto.getRandomValues(new Uint8Array(12));
            const source = new URL(Deno.env.get('SUPABASE_URL') + '/functions/v1/edpvz-ivideon-check');
            // Reuse the provider media redirect for the worker as well as the browser.
            source.searchParams.set('download',await issueTicket(download,Date.now()+15*60*1000,'browser-download'));
            const plain=new TextEncoder().encode(JSON.stringify({url:source.href,expires:Date.now()+15*60*1000}));
            const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},cipherKey,plain));
            const sealedSource=btoa(Array.from([...iv,...cipher],byte=>String.fromCharCode(byte)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
            return reply({state:'ready',sealedSource});
          }
          const link = new URL(Deno.env.get('SUPABASE_URL') + '/functions/v1/edpvz-ivideon-check');
          link.searchParams.set('download',await issueTicket(download,Date.now()+(archive.share === true ? 24*60*60*1000 : 5*60*1000),archive.browserDownload === true ? 'browser-download' : 'download',mediaGrant));
          return reply({state:'ready',downloadUrl:link.href});
        }
        if (['failed','error','cancelled','expired','deleted'].includes(record.status)) return reply({state:'failed'});
        const progress = Number(record.progress);
        return reply({state:'pending',progress:Number.isFinite(progress) ? Math.min(100,Math.max(0,Math.round(progress))) : null});
      }
      if (archive !== undefined) {
        const start = archive?.start;
        const end = archive?.end;
        const now = Math.floor(Date.now()/1000);
        if ((!mediaGrant && action !== 'load') || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
            start <= 0 || start >= now || end <= start || end > now + 30 || end - start > (archive.mode === 'export' ? 18000 : 3600)) {
          return reply({error:archive.mode === 'export' ? 'Укажи прошедшее время и интервал до 5 часов.' : 'Укажи прошедшее время и интервал до одного часа.'}, 400);
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
          if (mediaGrant) {
            await serviceRows(exportsTable,{on_conflict:'share_id,export_id'},'POST',{share_id:mediaGrant.id,export_id:id});
          }
          return reply({exportId:id});
        }
        let status = 0;
        const requestedProfiles = archive.profile === 'high' ? ['2'] : archive.profile === 'low' ? ['1'] : ['2','1'];
        for (const profile of requestedProfiles) {
          const endpoint = new URL('https://openapi-alpha.ivideon.com/cameras/' + cameraId + '/archive_stream');
          endpoint.search = new URLSearchParams({
            op:'GET',access_token:key,format:'hls',q:profile,start_time:String(start),end_time:String(Math.min(now,Math.max(end,start+60))),duration:String(Math.min(now,Math.max(end,start+60))-start),speed:'1',
          }).toString();
          const response = await fetch(endpoint,{redirect:'manual',signal:deadline});
          status = response.status;
          if (status === 401 || status === 403) return reply({error:'Ключ Ivideon не даёт доступа к архиву этой камеры.'},422);
          const location = response.headers.get('location');
          const data = location ? null : await response.json().catch(() => null);
          const target = location ?? (data?.success === true ? data?.result?.url : null);
          if (typeof target !== 'string') continue;
          const url = hlsTarget(target,endpoint.href);
          const streamUrl = (mediaGrant || decodeURIComponent(url.href).includes(key)) ? await hlsLink(url, Date.now() + 15 * 60 * 1000, mediaGrant) : url.href;
          return reply({streamType:'hls',streamUrl});
        }
        return reply({error:'Ivideon не выдал запись за этот период (HTTP ' + status + '). Проверь другой интервал.'},422);
      }
      const endpoint = new URL('https://openapi-alpha.ivideon.com/cameras/' + cameraId + '/live_stream');
      endpoint.search = new URLSearchParams({
        op:'GET', access_token:key, q:quality === 1 ? '1' : '2', video_codecs:'h264',
        ...(quality === 1 ? {} : {audio_codecs:'none'}), format:'ws-fmp4',
      }).toString();
      if (['hls','high','low',1].includes(quality)) {
        try {
          const hls = new URL(endpoint.href);
          hls.searchParams.set('format', 'hls');
          hls.searchParams.set('q', quality === 'high' || quality === 1 ? '2' : '1');
          hls.searchParams.delete('audio_codecs');
          hls.searchParams.delete('video_codecs');
          const res = await fetch(hls, {redirect:'manual', signal:AbortSignal.timeout(3500)});
          const location = res.headers.get('location');
          const data = location ? null : await res.json().catch(() => null);
          const target = location ?? (data?.success === true ? data?.result?.url : null);
          if (typeof target === 'string') {
            const url = hlsTarget(target, hls.href);
            const streamUrl = (mediaGrant || decodeURIComponent(url.href).includes(key)) ? await hlsLink(url, Date.now() + 15 * 60 * 1000, mediaGrant) : url.href;
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
      if (mediaGrant || decoded.includes(key) || /xtok-/i.test(decoded)) {
        const relayUrl = new URL(Deno.env.get('SUPABASE_URL') + '/functions/v1/edpvz-ivideon-check');
        relayUrl.protocol = 'wss:';
        relayUrl.searchParams.set('ticket', await issueTicket(url,Date.now()+30000,'ws',mediaGrant));
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
      if (action === 'add') {
        await extraConnections(userId, undefined, 'POST', {
          user_id:userId, id:crypto.randomUUID(), label:accountLabel.trim(),
          encrypted_key:await connectionCipher(userId, key, true),
        });
      }
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

