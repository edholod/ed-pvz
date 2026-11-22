const VK = "https://id.vk.com";
const project = Deno.env.get("SUPABASE_URL") || "";
const gateway = project + "/functions/v1/edpvz-vk-id";
const supabaseCallback = project + "/auth/v1/callback";
const vkCallback = gateway + "/callback";
const clientId = Deno.env.get("EDPVZ_VK_APP_ID") || "";
const secret = Deno.env.get("EDPVZ_VK_OAUTH_BRIDGE_SECRET") || "";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const validState = (state: string) => /^[\da-f-]{36}$/i.test(state);
const configured = /^\d+$/.test(clientId) && /^[a-f\d]{64}$/i.test(secret) && Boolean(project);
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unbase64url(value: string) {
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
}

function redirect(url: string, values: Record<string, string>) {
  return new Response(null, { status: 302, headers: { ...headers, Location: url + "?" + new URLSearchParams(values) } });
}

function fail(status: number, error: string) {
  return Response.json({ error }, { status, headers });
}

async function derive(label: string, state = "") {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(label + ":" + state)));
}

async function envelopeKey() {
  return crypto.subtle.importKey("raw", await derive("authorization-code"), "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function postVK(path: string, params: URLSearchParams, body: URLSearchParams) {
  const response = await fetch(VK + path + "?" + params, {
    method: "POST",
    body,
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
  const result = await response.json();
  if (!response.ok || result?.error) return null;
  return result;
}

Deno.serve(async (request: Request) => {
  const url = new URL(request.url);
  const route = url.pathname.split("/").pop();
  const params = url.searchParams;
  if (route === "status" && request.method === "GET") {
    return Response.json({ configured }, { headers: { ...headers, "Access-Control-Allow-Origin": "*" } });
  }
  if (!configured) return fail(503, "provider_unavailable");

  try {
    if (route === "authorize" && request.method === "GET") {
      const state = params.get("state") || "";
      if (!validState(state) || params.get("client_id") !== clientId ||
          params.get("redirect_uri") !== supabaseCallback || params.get("response_type") !== "code") {
        return fail(400, "invalid_request");
      }
      const verifier = base64url(await derive("vk-pkce", state));
      const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier))));
      return redirect(VK + "/authorize", {
        client_id: clientId, response_type: "code", redirect_uri: vkCallback,
        state, code_challenge: challenge, code_challenge_method: "S256",
      });
    }

    if (route === "callback" && request.method === "GET") {
      const state = params.get("state") || "";
      if (!validState(state)) return fail(400, "invalid_request");
      const code = params.get("code");
      const deviceId = params.get("device_id");
      if (!code || !deviceId || code.length > 2000 || deviceId.length > 512 || params.has("error")) {
        return redirect(supabaseCallback, { state, error: "access_denied" });
      }
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const payload = encoder.encode(JSON.stringify({ state, code, deviceId, time: Date.now() }));
      const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await envelopeKey(), payload);
      return redirect(supabaseCallback, { state, code: base64url(iv) + "." + base64url(new Uint8Array(sealed)) });
    }

    if (route === "token" && request.method === "POST") {
      const form = await request.formData();
      const bearer = request.headers.get("Authorization");
      const credentials = bearer?.startsWith("Basic ") ? atob(bearer.slice(6)) :
        String(form.get("client_id")) + ":" + String(form.get("client_secret"));
      const actual = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(credentials)));
      const expected = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(clientId + ":" + secret)));
      if (actual.reduce((difference, byte, index) => difference | (byte ^ expected[index]), 0)) {
        return fail(401, "invalid_client");
      }
      if (form.get("grant_type") !== "authorization_code" || form.get("redirect_uri") !== supabaseCallback) {
        return fail(400, "invalid_request");
      }
      const grant = String(form.get("code"));
      const pieces = grant.length < 5000 && /^([\w-]{16})\.([\w-]+)$/.exec(grant);
      if (!pieces) return fail(400, "invalid_grant");
      let authorization;
      try {
        const payload = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: unbase64url(pieces[1]) }, await envelopeKey(), unbase64url(pieces[2]),
        );
        authorization = JSON.parse(decoder.decode(payload));
      } catch {
        return fail(400, "invalid_grant");
      }
      if (Date.now() - authorization.time > 120_000) return fail(400, "invalid_grant");
      const { state, code, deviceId } = authorization;
      const result = await postVK("/oauth2/auth", new URLSearchParams({
        grant_type: "authorization_code", client_id: clientId, redirect_uri: vkCallback,
        state, device_id: deviceId, code_verifier: base64url(await derive("vk-pkce", state)),
      }), new URLSearchParams({ code }));
      if (!result?.access_token || result.state !== state) return fail(400, "invalid_grant");
      return Response.json({ access_token: result.access_token, token_type: "Bearer", expires_in: result.expires_in }, { headers });
    }

    if (route === "userinfo" && request.method === "GET") {
      const accessToken = request.headers.get("Authorization")?.match(/^Bearer ([^\s]+)$/i)?.[1];
      if (!accessToken) return fail(401, "invalid_token");
      const result = await postVK("/oauth2/user_info", new URLSearchParams({ client_id: clientId }),
        new URLSearchParams({ access_token: accessToken }));
      const sub = String(result?.user?.user_id ?? "");
      if (!/^\d+$/.test(sub)) return fail(401, "invalid_token");
      return Response.json({ sub }, { headers });
    }
    return fail(404, "not_found");
  } catch {
    return fail(502, "provider_error");
  }
});
