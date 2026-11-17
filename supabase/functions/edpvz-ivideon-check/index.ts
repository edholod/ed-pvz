const origin = 'https://edpvz.ru';
const headers = {'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store'};
const reply = (body: unknown, status = 200) => Response.json(body, {status, headers});
Deno.serve(async (req) => {
  if (req.headers.get('origin') !== origin) return reply({error:'Доступ запрещён'}, 403);
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
      const url = new URL(stream.result.url);
      if (url.protocol !== 'wss:' || url.username || url.password ||
          !/(^|\.)(ivideon\.com|iv-cdn\.com|extcam\.com)$/.test(url.hostname) ||
          decodeURIComponent(url.href).includes(key) || /xtok-/i.test(decodeURIComponent(url.href))) {
        return reply({error:'Ivideon вернул неподдерживаемый адрес эфира.'}, 422);
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
