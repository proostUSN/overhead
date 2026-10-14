// Overhead relay for a home server (Synology NAS, Raspberry Pi, any machine with Node 18+).
// Lets the Overhead web app read the free ADS-B networks from your home connection.
//
// Safety design:
//  - forwards ONLY to the three flight-data hosts below; nothing else, no files, no local network
//  - answers only the app's own web page (CORS origin check)
//  - shares each answer for a few seconds, so many viewers cost one upstream request
//  - limits each visitor and the relay as a whole, so a stranger can't run up your home IP
//  - no dependencies; uses Node's built-in http server and fetch
import http from 'node:http';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';          // only reachable via Tailscale in the same container network

const ALLOWED_HOSTS = new Set(['api.airplanes.live', 'api.adsb.lol', 'opendata.adsb.fi']);
const ALLOWED_ORIGINS = new Set((process.env.ALLOWED_ORIGINS || 'https://proostusn.github.io').split(',').map(s => s.trim()).filter(Boolean));
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|[\w-]+\.local|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/;

const CACHE_MS = 5_000;
const PER_VISITOR_PER_MIN = Number(process.env.PER_VISITOR_PER_MIN || 30);   // app needs ~6–12/min
const UPSTREAM_PER_MIN = Number(process.env.UPSTREAM_PER_MIN || 50);         // stays under airplanes.live's 1/s
const UPSTREAM_TIMEOUT_MS = 8_000;
const MAX_BODY = 4_096;
const UA = 'Overhead flight tracker (+https://github.com/proostUSN/overhead)';

const cache = new Map();          // url -> { at, status, type, body }
const visitors = new Map();       // ip -> [timestamps]
let upstreamHits = [];

const originOK = o => ALLOWED_ORIGINS.has(o) || LOCAL_ORIGIN.test(o);
function cors(origin) {
  return {
    'Access-Control-Allow-Origin': originOK(origin) ? origin : [...ALLOWED_ORIGINS][0] || 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}
function send(res, status, headers, body) {
  res.writeHead(status, { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
function allowVisitor(ip, now) {
  const recent = (visitors.get(ip) || []).filter(t => now - t < 60_000);
  const ok = recent.length < PER_VISITOR_PER_MIN;
  if (ok) recent.push(now);
  visitors.set(ip, recent);
  return ok;
}
function allowUpstream(now) {
  upstreamHits = upstreamHits.filter(t => now - t < 60_000);
  if (upstreamHits.length >= UPSTREAM_PER_MIN) return false;
  upstreamHits.push(now);
  return true;
}
function clientIP(req) {
  const xf = req.headers['x-forwarded-for'];
  return (Array.isArray(xf) ? xf[0] : xf || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
}
async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > MAX_BODY) throw new Error('too large'); chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  const h = cors(origin);
  try {
    if (req.method === 'OPTIONS') return send(res, 204, h, '');
    const url = new URL(req.url, 'http://relay');
    const raw = url.searchParams.get('url');
    if (!raw) return send(res, 200, { ...h, 'Content-Type': 'text/plain' }, 'Overhead relay is running. Pass ?url=<feed URL>.');
    if (!originOK(origin)) return send(res, 403, { ...h, 'Content-Type': 'text/plain' }, 'This relay only serves the Overhead app.');
    if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, h, 'Method not allowed');

    let target;
    try { target = new URL(raw); } catch { return send(res, 400, h, 'Bad url'); }
    if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname) || target.port) return send(res, 403, h, 'Host not allowed');

    const now = Date.now();
    if (!allowVisitor(clientIP(req), now)) return send(res, 429, { ...h, 'Retry-After': '20' }, 'Slow down');

    const key = target.toString();
    if (req.method === 'GET') {
      const hit = cache.get(key);
      if (hit && now - hit.at < CACHE_MS) return send(res, hit.status, { ...h, 'Content-Type': hit.type, 'X-Relay-Cache': 'hit' }, hit.body);
    }
    if (!allowUpstream(now)) return send(res, 429, { ...h, 'Retry-After': '10' }, 'Relay busy');

    const init = { method: req.method, headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) };
    if (req.method === 'POST') { init.headers['Content-Type'] = 'application/json'; init.body = await readBody(req); }
    const up = await fetch(key, init);
    const body = Buffer.from(await up.arrayBuffer());
    const type = (up.headers.get('content-type') || 'application/json').split(';')[0];
    if (req.method === 'GET' && up.ok) {
      cache.set(key, { at: now, status: up.status, type, body });
      if (cache.size > 500) cache.delete(cache.keys().next().value);
    }
    return send(res, up.status, { ...h, 'Content-Type': type, 'X-Relay-Cache': 'miss' }, body);
  } catch (e) {
    return send(res, e.name === 'TimeoutError' ? 504 : 502, h, 'Upstream unavailable');
  }
});

// Tidy rate-limit memory every few minutes.
setInterval(() => { const now = Date.now(); for (const [k, v] of visitors) if (!v.some(t => now - t < 60_000)) visitors.delete(k); }, 180_000).unref();

server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.listen(PORT, HOST, () => console.log(`Overhead relay listening on ${HOST}:${PORT}`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
