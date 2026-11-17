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
    let key;
    try { key = JSON.parse(raw)?.key; } catch { return reply({error:'Некорректный запрос'}, 400); }
    if (typeof key !== 'string' || !/^xtok-[a-zA-Z0-9_.~+/=\-]{8,512}$/.test(key)) return reply({error:'Нужен ключ Ivideon формата xtok-…'}, 400);
    const url = new URL('https://openapi-alpha.ivideon.com/cameras');
    url.search = new URLSearchParams({op:'GET', access_token:key}).toString();
    const response = await fetch(url, {redirect:'error', signal:AbortSignal.timeout(8000)});
    if ([401,403].includes(response.status)) return reply({error:'Ivideon отклонил этот ключ для запроса списка камер.'}, 422);
    if (!response.ok) return reply({error:'Ivideon не вернул список камер.', providerStatus:response.status}, 502);
    const data = await response.json();
    const list = Array.isArray(data?.result) ? data.result : data?.result?.cameras;
    if (data?.success !== true || !Array.isArray(list)) return reply({error:'Ivideon не подтвердил доступ к списку камер через этот API.'}, 422);
    return reply({cameras:list.slice(0, 250).map((item) => ({name: typeof item?.name === 'string' ? item.name.slice(0, 160) : 'Камера Ivideon'}))});
  } catch {
    return reply({error:'Не удалось завершить проверку Ivideon. Повторите позже.'}, 502);
  }
});
