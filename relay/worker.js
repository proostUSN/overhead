/* Overhead relay — a Cloudflare Worker that lets the Overhead web app read the free ADS-B feeds.
   The feeds don't send CORS headers, so browsers block pages on other sites from reading them.
   This Worker forwards requests ONLY to the hosts below, adds CORS headers for the app's own
   origins, and caches each answer for a few seconds so many viewers share one upstream call.

   Deploy: Cloudflare dashboard → Workers & Pages → Create → Worker → paste this file → Deploy.
   Then put the Worker's URL (https://<name>.<you>.workers.dev) in Overhead → Settings → Relay. */

const ALLOWED_HOSTS = new Set([
  'api.airplanes.live',
  'api.adsb.lol',
  'opendata.adsb.fi',
]);

// Pages allowed to use this relay. Add your own domain here if you host the app elsewhere.
const ALLOWED_ORIGINS = [
  'https://proostusn.github.io',
];
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|[\w-]+\.local|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/;

const CACHE_SECONDS = 5;

function corsHeaders(origin) {
  const ok = ALLOWED_ORIGINS.includes(origin) || LOCAL_ORIGIN.test(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const reqUrl = new URL(request.url);
    const raw = reqUrl.searchParams.get('url');
    if (!raw) return new Response('Overhead relay is running. Pass ?url=<feed URL>.', { status: 200, headers: { ...cors, 'Content-Type': 'text/plain' } });

    let target;
    try { target = new URL(raw); } catch { return new Response('Bad url', { status: 400, headers: cors }); }
    if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) {
      return new Response('Host not allowed', { status: 403, headers: cors });
    }
    if (request.method !== 'GET' && request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

    const upstreamInit = {
      method: request.method,
      headers: { 'User-Agent': 'Overhead flight tracker (+https://github.com/proostUSN/overhead)', 'Accept': 'application/json' },
    };
    if (request.method === 'POST') {
      upstreamInit.headers['Content-Type'] = 'application/json';
      upstreamInit.body = await request.text();
    }

    // Share GET answers between viewers for a few seconds.
    const cache = caches.default;
    const cacheKey = new Request(target.toString(), { method: 'GET' });
    if (request.method === 'GET') {
      const hit = await cache.match(cacheKey);
      if (hit) return withCors(hit, cors);
    }

    let upstream;
    try { upstream = await fetch(target.toString(), upstreamInit); }
    catch { return new Response('Upstream unreachable', { status: 502, headers: cors }); }

    const body = await upstream.arrayBuffer();
    const res = new Response(body, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('Content-Type') || 'application/json', 'Cache-Control': `public, max-age=${CACHE_SECONDS}` },
    });
    if (request.method === 'GET' && upstream.ok) ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return withCors(res, cors);
  },
};

function withCors(res, cors) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
  return out;
}
