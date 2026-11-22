Deno.serve(async (request: Request) => {
  const headers = { "Cache-Control": "no-store" };
  if (request.method !== "GET") return new Response(null, { status: 405, headers });

  const token = request.headers.get("Authorization")?.match(/^Bearer ([A-Za-z0-9._~-]+)$/i)?.[1];
  if (!token) return new Response(null, { status: 401, headers });

  try {
    const response = await fetch("https://login.yandex.ru/info?format=json", {
      headers: { Authorization: "OAuth " + token },
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      const status = [400, 401, 403].includes(response.status) ? 401 : 502;
      return new Response(null, { status, headers });
    }
    const { id } = await response.json();
    if (typeof id !== "string" || !/^\d+$/.test(id)) {
      return new Response(null, { status: 502, headers });
    }
    return Response.json({ sub: id }, { headers });
  } catch {
    return new Response(null, { status: 502, headers });
  }
});
