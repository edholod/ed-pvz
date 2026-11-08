import http from 'node:http';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Collector} from './collector.mjs';
import {encodeSession} from './session.mjs';

const COOKIE = 'ed_wb_admin';
const SESSION_MS = 8 * 3600000;
const root = new URL('./public/', import.meta.url);
function equal(a, b) {
  const left = Buffer.from(String(a)), right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}
function cookie(req) {
  return (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
}
export function createServer({collector, adminToken, publish = false, secure = true, allowedOrigin = 'https://edholod.github.io'}) {
  if (!adminToken || adminToken.length < 32) throw new Error('ADMIN_TOKEN must contain at least 32 characters');
  const sessions = new Map();
  const sockets = new Set();
  const attempts = new Map();
  const authorized = req => {
    const token = cookie(req), until = sessions.get(token);
    if (!until || until <= Date.now()) { sessions.delete(token); return false; }
    return true;
  };
  const originOK = req => {
    try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; }
  };
  const closeControl = () => { for (const socket of sockets) socket.destroy(); sockets.clear(); };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'");
    if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    if (req.headers.origin === allowedOrigin && req.url?.startsWith('/api/')) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      res.setHeader('Vary', 'Origin');
    }
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, {'Content-Type': type + '; charset=utf-8'});
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'OPTIONS' && pathname.startsWith('/api/')) {
        res.setHeader('Access-Control-Allow-Methods', 'GET'); return send(204, '');
      }
      if (req.method === 'GET' && pathname === '/healthz') return send(200, {ok: true});
      if (req.method === 'GET' && pathname === '/api/status') return send(200, {...collector.status(), publicationEnabled: publish});
      if (req.method === 'GET' && pathname === '/api/news') {
        if (!publish) return send(403, {error: 'publication_disabled'});
        return send(collector.feed.items.length ? 200 : 503, {...collector.feed, status: collector.status(), source: 'my-pvz'});
      }
      if (req.method === 'POST' && !originOK(req)) return send(403, {error: 'origin_rejected'});
      if (req.method === 'POST' && pathname === '/admin/login') {
        const key = req.socket.remoteAddress || 'unknown';
        const recent = (attempts.get(key) || []).filter(time => time > Date.now() - 600000);
        if (recent.length >= 12) return send(429, {error: 'too_many_attempts'});
        recent.push(Date.now()); attempts.set(key, recent);
        if (attempts.size > 1000) attempts.clear();
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 4096) return send(413, {error: 'request_too_large'}); }
        if (!equal(new URLSearchParams(body).get('token') || '', adminToken)) return send(401, {error: 'invalid_token'});
        const token = randomBytes(32).toString('hex');
        for (const [id, until] of sessions) if (until <= Date.now()) sessions.delete(id);
        if (sessions.size > 20) sessions.clear();
        sessions.set(token, Date.now() + SESSION_MS);
        res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secure ? '; Secure' : ''}`);
        return send(200, {ok: true});
      }
      if (pathname.startsWith('/vnc/')) {
        if (!authorized(req) || collector.controlUntil <= Date.now()) return send(403, {error: 'control_closed'});
        const upstream = http.request({host: '127.0.0.1', port: 6080, path: req.url.slice(4), method: req.method}, response => {
          res.writeHead(response.statusCode, {'Content-Type': response.headers['content-type'] || 'application/octet-stream'});
          response.pipe(res);
        });
        upstream.on('error', () => { if (!res.headersSent) send(502, {error: 'desktop_unavailable'}); else res.destroy(); });
        req.pipe(upstream); return;
      }
      if (pathname === '/admin/status' || (pathname.startsWith('/admin/') && req.method === 'POST')) {
        if (!authorized(req)) return send(401, {error: 'authentication_required'});
        if (req.method === 'GET' && pathname === '/admin/status') return send(200, collector.status());
        if (req.method === 'POST' && pathname === '/admin/export-session') {
          if (collector.running || collector.controlUntil > Date.now()) return send(409, {error: 'finish_login_first'});
          if (!['ok','partial'].includes(collector.state) || !collector.context) return send(409, {error: 'sign_in_to_wb_first'});
          const encoded = encodeSession(await collector.context.storageState());
          res.setHeader('Content-Disposition', 'attachment; filename="WB_SESSION.txt"');
          return send(200, encoded, 'text/plain');
        }
        if (req.method === 'POST' && pathname === '/admin/begin') {
          const ok = await collector.beginControl();
          return send(ok ? 200 : 409, {ok, error: ok ? undefined : 'collection_in_progress'});
        }
        if (req.method === 'POST' && pathname === '/admin/finish') {
          closeControl();
          collector.finishControl().catch(() => console.error('collection_failed'));
          return send(202, {ok: true});
        }
        if (req.method === 'POST' && pathname === '/admin/logout') {
          sessions.delete(cookie(req)); closeControl(); collector.controlUntil = 0;
          res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`);
          return send(200, {ok: true});
        }
      }
      const assets = {'/': ['index.html', 'text/html'], '/admin': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript']};
      if (req.method === 'GET' && assets[pathname]) {
        const [name, type] = assets[pathname]; return send(200, await readFile(new URL(name, root), 'utf8'), type);
      }
      return send(404, {error: 'not_found'});
    } catch { if (!res.headersSent) send(500, {error: 'internal_error'}); else res.destroy(); }
  });
  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/vnc/') || !authorized(req) || !originOK(req) || collector.controlUntil <= Date.now()) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    const timer = setTimeout(() => socket.destroy(), collector.controlUntil - Date.now());
    sockets.add(socket);
    socket.once('close', () => {clearTimeout(timer); sockets.delete(socket);});
    const headers = {...req.headers, host: '127.0.0.1:6080'};
    delete headers.cookie;
    const upstream = http.request({host: '127.0.0.1', port: 6080, path: req.url.slice(4), headers});
    upstream.on('upgrade', (response, remote, remoteHead) => {
      socket.write(`HTTP/1.1 ${response.statusCode} Switching Protocols\r\n`);
      for (const [key, value] of Object.entries(response.headers)) socket.write(`${key}: ${value}\r\n`);
      socket.write('\r\n');
      if (remoteHead.length) socket.write(remoteHead);
      if (head.length) remote.write(head);
      remote.on('error', () => socket.destroy()); socket.on('error', () => remote.destroy());
      socket.on('close', () => remote.destroy());
      socket.pipe(remote).pipe(socket);
    });
    upstream.on('error', () => socket.destroy());
    upstream.on('response', () => socket.destroy());
    upstream.end();
  });
  server.on('close', closeControl);
  return server;
}

async function main() {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || adminToken.length < 32) throw new Error('ADMIN_TOKEN is required (minimum 32 characters)');
  const collector = new Collector(process.env.DATA_DIR || '/var/lib/ed-pvz', {
    intervalMs: Math.max(300, Number(process.env.POLL_SECONDS) || 900) * 1000,
  });
  const server = createServer({collector, adminToken, publish: process.env.PUBLISH_APPROVED === 'true'});
  server.listen(Number(process.env.PORT) || 3000, '0.0.0.0');
  collector.start({paused: process.env.START_PAUSED === 'true'}).catch(() => { collector.state = 'browser_failed'; console.error('browser_start_failed'); });
  for (const signal of ['SIGTERM','SIGINT']) process.on(signal, async () => {
    server.close(); await collector.close(); process.exit(0);
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(() => {console.error('startup_failed'); process.exit(1);});
