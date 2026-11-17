const origin = 'https://edpvz.ru';
const headers = {'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store'};
const reply = (body: unknown, status = 200) => Response.json(body, {status, headers});
function secureStreamUrl(raw: string) {
  const url = new URL(raw);
  if (!['ws:', 'wss:', 'http:', 'https:'].includes(url.protocol) ||
      url.username || url.password ||
      !/(^|\.)(ivideon\.com|iv-cdn\.com|extcam\.com)$/.test(url.hostname)) return null;
  return new URL('wss:' + url.href.slice(url.protocol.length));
}
async function ticketKey() {
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret) throw Error('Relay unavailable');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('edpvz-ivideon-live:' + secret));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function issueTicket(url: URL) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify({url: url.href, expires: Date.now() + 30000}));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv}, await ticketKey(), plaintext));
  return btoa(Array.from([...iv,...cipher], (byte) => String.fromCharCode(byte)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
async function relay(req: Request, ticket: string) {
  let upstreamUrl;
  try {
    if (!/^[a-zA-Z0-9_-]{40,12000}$/.test(ticket)) throw Error();
    const bytes = Uint8Array.from(atob(ticket.replace(/-/g,'+').replace(/_/g,'/')), (char) => char.charCodeAt(0));
    const plain = await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12)}, await ticketKey(), bytes.slice(12));
    const {url, expires} = JSON.parse(new TextDecoder().decode(plain));
    if (typeof expires !== 'number' || expires < Date.now() || !(upstreamUrl = secureStreamUrl(url))) throw Error();
  } catch {
    return reply({error:'Ссылка на эфир истекла.'}, 403);
  }
  const {socket, response} = Deno.upgradeWebSocket(req);
  let upstream: WebSocket | undefined;
  const end = () => {
    if (upstream && upstream.readyState < WebSocket.CLOSING) upstream.close();
    if (socket.readyState === WebSocket.OPEN) socket.close();
  };
  socket.onclose = end;
  socket.onerror = end;
  socket.onopen = () => {
    try {
      upstream = new WebSocket(upstreamUrl.href);
      upstream.binaryType = 'arraybuffer';
      upstream.onmessage = ({data}) => {
        if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 16 * 1024 * 1024) return end();
        try { socket.send(data); } catch { end(); }
      };
      upstream.onclose = end;
      upstream.onerror = end;
    } catch { end(); }
  };
  return response;
}

Deno.serve(async (req) => {
  if (req.headers.get('origin') !== origin) return reply({error:'Доступ запрещён'}, 403);
  if (req.method === 'GET' && req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
    return relay(req, new URL(req.url).searchParams.get('ticket') ?? '');
  }
  if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers});
  if (req.method !== 'POST') return reply({error:'Метод недоступен'}, 405);
  const authorization = req.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return reply({error:'Войдите в Эд ПВЗ'}, 401);
  try {
    const session = await fetch(Deno.env.get('SUPABASE_URL') + '/rest/v1/rpc/edpvz_surveillance_allowed', {
      method:'POST', headers:{authorization, apikey: Deno.env.get('SUPABASE_ANON_KEY')!, 'content-type':'application/json'},
      body:'{}', signal:AbortSignal.timeout(5000)
    });
    if (!session.ok || await session.json() !== true) return reply({error:'Доступ запрещён'}, 403);
    const raw = await req.text();
    if (raw.length > 2048) return reply({error:'Некорректный запрос'}, 400);
    let payload;
    try { payload = JSON.parse(raw); } catch { return reply({error:'Некорректный запрос'}, 400); }
    const {key, cameraId} = payload ?? {};
    if (typeof key !== 'string' || !/^xtok-[a-zA-Z0-9_.~+/=\-]{8,512}$/.test(key)) return reply({error:'Нужен ключ Ivideon формата xtok-…'}, 400);
    const deadline = AbortSignal.timeout(8500);
    if (cameraId !== undefined) {
      if (typeof cameraId !== 'string' || !/^[a-zA-Z0-9_-]{1,120}:[0-9]{1,8}$/.test(cameraId)) {
        return reply({error:'Некорректный ID камеры Ivideon.'}, 400);
      }
      const endpoint = new URL('https://openapi-alpha.ivideon.com/cameras/' + cameraId + '/live_stream');
      endpoint.search = new URLSearchParams({
        op:'GET', access_token:key, q:'2', video_codecs:'h264', audio_codecs:'none', format:'ws-fmp4',
      }).toString();
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
      return reply({cameras:list.slice(0,250).map((item) => ({
        id: typeof item?.id === 'string' && /^[a-zA-Z0-9_-]{1,120}:[0-9]{1,8}$/.test(item.id) ? item.id : null,
        name: typeof item?.name === 'string' ? item.name.slice(0,160) : 'Камера Ivideon',
      }))});
    }
    return reply({error:'Ivideon не подтвердил получение камер (' + statuses.join(', ') + ').'}, 422);
  } catch {
    return reply({error:'Не удалось завершить проверку Ivideon. Повторите позже.'}, 502);
  }
});
