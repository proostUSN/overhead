/* Overhead — aircraft near you from free ADS-B networks or your own receiver.
   No build step. Works as a PWA on a phone and as a kiosk page on a Raspberry Pi. */
(() => {
'use strict';

/* ---------- settings ---------- */
const DEFAULTS = {
  source: 'auto',            // auto | airplaneslive | adsblol | adsbfi | local
  localUrl: '/tar1090/data/aircraft.json',
  radiusMi: 5,
  refreshSec: 10,
  locMode: 'gps',            // gps | fixed
  lat: null, lon: null,
  units: 'imperial',
  showGround: false,
  kiosk: false,
  demo: false,
};
const LS_KEY = 'overhead.settings.v1';

function store(key, val) { try { if (val === undefined) return JSON.parse(localStorage.getItem(key) || 'null'); localStorage.setItem(key, JSON.stringify(val)); } catch { return null; } }

const cfg = Object.assign({}, DEFAULTS, store(LS_KEY) || {});
// URL parameters override saved settings (handy for the Pi kiosk command line).
const qp = new URLSearchParams(location.search);
const num = v => (v === null || v === '' || isNaN(+v)) ? null : +v;
if (qp.has('lat') && qp.has('lon')) { cfg.lat = num(qp.get('lat')); cfg.lon = num(qp.get('lon')); cfg.locMode = 'fixed'; }
if (qp.has('radius')) cfg.radiusMi = num(qp.get('radius')) || cfg.radiusMi;
if (qp.has('refresh')) cfg.refreshSec = Math.max(5, num(qp.get('refresh')) || cfg.refreshSec);
if (qp.has('source')) cfg.source = qp.get('source');
if (qp.has('url')) { cfg.localUrl = qp.get('url'); if (!qp.has('source')) cfg.source = 'local'; }
if (qp.has('kiosk')) cfg.kiosk = qp.get('kiosk') !== '0';
if (qp.has('demo')) cfg.demo = qp.get('demo') !== '0';
if (qp.has('units')) cfg.units = qp.get('units') === 'metric' ? 'metric' : 'imperial';
if (qp.has('ground')) cfg.showGround = qp.get('ground') !== '0';

/* ---------- geometry ---------- */
const R_MI = 3958.8, MI_PER_NM = 1.15078;
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
function distMi(a, b, c, d) {
  const dLat = rad(c - a), dLon = rad(d - b);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}
function bearing(a, b, c, d) {
  const y = Math.sin(rad(d - b)) * Math.cos(rad(c));
  const x = Math.cos(rad(a)) * Math.sin(rad(c)) - Math.sin(rad(a)) * Math.cos(rad(c)) * Math.cos(rad(d - b));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
const CARD = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const cardinal = b => CARD[Math.round(b / 45) % 8];

/* ---------- formatting ---------- */
const metric = () => cfg.units === 'metric';
function fmtAlt(a) {
  if (a.ground) return 'GND';
  if (a.alt == null) return '—';
  if (metric()) return `${Math.round(a.alt * 0.3048).toLocaleString()}<small> m</small>`;
  if (a.alt >= 18000) return `FL${String(Math.round(a.alt / 100)).padStart(3, '0')}`;
  return `${Math.round(a.alt).toLocaleString()}<small> ft</small>`;
}
const fmtSpd = gs => gs == null ? '—' : metric() ? `${Math.round(gs * 1.852)} km/h` : `${Math.round(gs)} kt`;
const fmtDist = mi => metric() ? `${(mi * 1.609).toFixed(1)} km` : `${mi.toFixed(1)} mi`;
const fmtRate = v => v == null ? '—' : metric() ? `${Math.round(v * 0.00508 * 10) / 10} m/s` : `${v > 0 ? '+' : ''}${Math.round(v / 10) * 10} fpm`;
const trend = a => a.ground || a.vrate == null ? '' : a.vrate > 300 ? 'climb' : a.vrate < -300 ? 'desc' : '';
const trendArrow = a => ({ climb: ' ↑', desc: ' ↓' }[trend(a)] || '');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- aircraft type names ---------- */
const TYPES = {
  A19N:'Airbus A319neo',A20N:'Airbus A320neo',A21N:'Airbus A321neo',A318:'Airbus A318',A319:'Airbus A319',A320:'Airbus A320',A321:'Airbus A321',
  A332:'Airbus A330-200',A333:'Airbus A330-300',A339:'Airbus A330-900neo',A343:'Airbus A340-300',A359:'Airbus A350-900',A35K:'Airbus A350-1000',A388:'Airbus A380',
  BCS1:'Airbus A220-100',BCS3:'Airbus A220-300',
  B712:'Boeing 717',B734:'Boeing 737-400',B735:'Boeing 737-500',B737:'Boeing 737-700',B738:'Boeing 737-800',B739:'Boeing 737-900',B37M:'Boeing 737 MAX 7',B38M:'Boeing 737 MAX 8',B39M:'Boeing 737 MAX 9',B3XM:'Boeing 737 MAX 10',
  B744:'Boeing 747-400',B748:'Boeing 747-8',B752:'Boeing 757-200',B753:'Boeing 757-300',B762:'Boeing 767-200',B763:'Boeing 767-300',B764:'Boeing 767-400',
  B772:'Boeing 777-200',B77L:'Boeing 777-200LR',B77W:'Boeing 777-300ER',B778:'Boeing 777-8',B779:'Boeing 777-9',B788:'Boeing 787-8',B789:'Boeing 787-9',B78X:'Boeing 787-10',
  CRJ2:'Bombardier CRJ200',CRJ7:'Bombardier CRJ700',CRJ9:'Bombardier CRJ900',CRJX:'Bombardier CRJ1000',
  E135:'Embraer ERJ-135',E145:'Embraer ERJ-145',E170:'Embraer E170',E75L:'Embraer E175',E75S:'Embraer E175',E190:'Embraer E190',E195:'Embraer E195',E290:'Embraer E190-E2',E295:'Embraer E195-E2',
  DH8D:'De Havilland Dash 8-400',AT72:'ATR 72',AT76:'ATR 72-600',AT45:'ATR 42-500',MD11:'McDonnell Douglas MD-11',MD88:'McDonnell Douglas MD-88',DC10:'McDonnell Douglas DC-10',
  C172:'Cessna 172 Skyhawk',C182:'Cessna 182 Skylane',C152:'Cessna 152',C208:'Cessna 208 Caravan',C510:'Cessna Citation Mustang',C525:'Cessna CitationJet',C56X:'Cessna Citation Excel',C680:'Cessna Citation Sovereign',C68A:'Cessna Citation Latitude',C700:'Cessna Citation Longitude',
  PA28:'Piper PA-28 Cherokee',PA32:'Piper PA-32',PA46:'Piper Malibu',P28A:'Piper PA-28 Cherokee',SR22:'Cirrus SR22',SR20:'Cirrus SR20',SF50:'Cirrus Vision Jet',BE36:'Beechcraft Bonanza',BE20:'Beechcraft King Air 200',B350:'Beechcraft King Air 350',BE9L:'Beechcraft King Air 90',
  PC12:'Pilatus PC-12',PC24:'Pilatus PC-24',TBM9:'Daher TBM 900',TBM7:'Daher TBM 700',
  GLF4:'Gulfstream IV',GLF5:'Gulfstream V',GLF6:'Gulfstream G650',GL5T:'Bombardier Global 5000',GLEX:'Bombardier Global Express',GL7T:'Bombardier Global 7500',CL30:'Bombardier Challenger 300',CL35:'Bombardier Challenger 350',CL60:'Bombardier Challenger 600',
  E55P:'Embraer Phenom 300',E50P:'Embraer Phenom 100',LJ45:'Learjet 45',LJ60:'Learjet 60',F2TH:'Dassault Falcon 2000',FA7X:'Dassault Falcon 7X',HDJT:'Honda HondaJet',
  R44:'Robinson R44',R22:'Robinson R22',R66:'Robinson R66',EC35:'Airbus H135',EC45:'Airbus H145',EC30:'Airbus H130',AS50:'Airbus AS350',B06:'Bell 206',B407:'Bell 407',B412:'Bell 412',S76:'Sikorsky S-76',A139:'Leonardo AW139',H60:'Sikorsky Black Hawk',
  C17:'Boeing C-17 Globemaster III',C130:'Lockheed C-130 Hercules',C30J:'Lockheed C-130J Super Hercules',K35R:'Boeing KC-135',T38:'Northrop T-38 Talon',F16:'General Dynamics F-16',
};
const CATEGORY = { A1:'Light aircraft', A2:'Small aircraft', A3:'Large aircraft', A4:'Boeing 757-class', A5:'Heavy aircraft', A6:'High performance', A7:'Helicopter', B1:'Glider', B2:'Balloon', B4:'Ultralight', B6:'Drone' };
function typeName(a) {
  const e = enrich.ac.get(a.hex);
  if (a.desc) return titleCase(a.desc);
  if (a.type && TYPES[a.type]) return TYPES[a.type];
  if (e && e.type) return `${e.manufacturer ? e.manufacturer + ' ' : ''}${e.type}`.trim();
  if (a.type) return a.type;
  return CATEGORY[a.category] || 'Unknown type';
}
function titleCase(s) { return s.toLowerCase().replace(/\b([a-z])/g, m => m.toUpperCase()).replace(/\b(Ii|Iii|Iv)\b/g, m => m.toUpperCase()); }
const isHeli = a => a.category === 'A7' || /^(R22|R44|R66|EC|AS|B06|B407|B412|S76|A139|H60)/.test(a.type || '');

/* ---------- data sources ---------- */
const nmFor = mi => Math.min(250, Math.max(1, Math.ceil(mi / MI_PER_NM) + 1));
const SOURCES = {
  airplaneslive: { label: 'airplanes.live', url: (lat, lon, mi) => `https://api.airplanes.live/v2/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${nmFor(mi)}` },
  adsblol:       { label: 'adsb.lol',       url: (lat, lon, mi) => `https://api.adsb.lol/v2/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${nmFor(mi)}` },
  adsbfi:        { label: 'adsb.fi',        url: (lat, lon, mi) => `https://opendata.adsb.fi/api/v2/lat/${lat.toFixed(4)}/lon/${lon.toFixed(4)}/dist/${nmFor(mi)}` },
  local:         { label: 'your receiver',  url: () => cfg.localUrl },
};
const AUTO_ORDER = ['airplaneslive', 'adsblol', 'adsbfi'];
let autoIdx = 0;

async function fetchJSON(url, opts = {}, timeoutMs = 9000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
    return await r.json();
  } finally { clearTimeout(t); }
}

function normalize(raw, nowSec) {
  const list = raw.ac || raw.aircraft || [];
  return list.map(x => {
    const ground = x.alt_baro === 'ground' || x.ground === true;
    const alt = ground ? 0 : (typeof x.alt_baro === 'number' ? x.alt_baro : (typeof x.alt_geom === 'number' ? x.alt_geom : null));
    return {
      hex: String(x.hex || '').replace(/^~/, '').toLowerCase(),
      callsign: String(x.flight || '').trim(),
      reg: x.r || '', type: x.t || '', desc: x.desc || '', op: x.ownOp || '',
      alt, ground, gs: x.gs ?? null, track: x.track ?? x.true_heading ?? x.mag_heading ?? null,
      vrate: x.baro_rate ?? x.geom_rate ?? null,
      lat: x.lat ?? x.lastPosition?.lat, lon: x.lon ?? x.lastPosition?.lon,
      seenPos: x.seen_pos ?? x.seen ?? 0,
      squawk: x.squawk || '', category: x.category || '', emergency: x.emergency && x.emergency !== 'none' ? x.emergency : '',
      year: x.year || '',
    };
  }).filter(a => a.hex && a.lat != null && a.lon != null && a.seenPos < 60);
}

async function getTraffic(lat, lon) {
  if (cfg.demo) return { list: demoTraffic(lat, lon), label: 'demo traffic' };
  const keys = cfg.source === 'auto' ? AUTO_ORDER : [cfg.source];
  let lastErr;
  for (let i = 0; i < keys.length; i++) {
    const key = cfg.source === 'auto' ? keys[(autoIdx + i) % keys.length] : keys[i];
    const src = SOURCES[key];
    if (!src) continue;
    try {
      const raw = await fetchJSON(src.url(lat, lon, cfg.radiusMi));
      if (cfg.source === 'auto') autoIdx = (autoIdx + i) % keys.length; // stick with what works
      return { list: normalize(raw), label: src.label };
    } catch (e) { lastErr = e; lastErr.source = src.label; }
  }
  throw lastErr || new Error('No data source');
}

/* ---------- enrichment: routes, aircraft records, photos ---------- */
const CACHE_KEY = 'overhead.cache.v1';
const enrich = { route: new Map(), ac: new Map(), photo: new Map(), pending: new Set(), queue: [] };
(function loadCache() {
  const c = store(CACHE_KEY); if (!c) return;
  const now = Date.now();
  for (const k of ['route', 'ac', 'photo']) for (const [id, v] of Object.entries(c[k] || {})) if (v && v.exp > now) enrich[k].set(id, v.data);
})();
let saveTimer;
function saveCache() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const out = {}; const now = Date.now();
    const ttl = { route: 6 * 3600e3, ac: 7 * 86400e3, photo: 7 * 86400e3 };
    for (const k of ['route', 'ac', 'photo']) {
      out[k] = {}; const entries = [...enrich[k].entries()].slice(-300);
      for (const [id, data] of entries) out[k][id] = { exp: now + ttl[k], data };
    }
    store(CACHE_KEY, out);
  }, 1500);
}

async function lookupRoute(a) {
  const cs = a.callsign.toUpperCase();
  // 1) adsbdb callsign database
  try {
    const j = await fetchJSON(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(cs)}`);
    const fr = j?.response?.flightroute;
    if (fr && fr.origin && fr.destination) {
      const ap = p => ({ code: p.iata_code || p.icao_code, icao: p.icao_code, name: p.name, city: p.municipality, lat: p.latitude, lon: p.longitude });
      return { from: ap(fr.origin), to: ap(fr.destination), airline: fr.airline?.name || '', via: 'adsbdb' };
    }
  } catch (e) { if (e.status && e.status !== 404) throw e; }
  // 2) adsb.lol route set (uses position to judge plausibility)
  try {
    const j = await fetchJSON('https://api.adsb.lol/api/0/routeset', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planes: [{ callsign: cs, lat: a.lat, lng: a.lon }] }),
    });
    const r = Array.isArray(j) ? j[0] : null;
    const aps = r?._airports;
    if (aps && aps.length >= 2) {
      const ap = p => ({ code: p.iata || p.icao, icao: p.icao, name: p.name, city: p.location, lat: p.lat, lon: p.lon });
      return { from: ap(aps[0]), to: ap(aps[aps.length - 1]), airline: '', via: 'adsb.lol', plausible: r.plausible !== false && r.plausible !== 0 };
    }
  } catch { /* fall through */ }
  return null;
}

async function lookupAircraft(hex) {
  try {
    const j = await fetchJSON(`https://api.adsbdb.com/v0/aircraft/${hex}`);
    const x = j?.response?.aircraft; if (!x) return null;
    return { type: x.type, icaoType: x.icao_type, manufacturer: x.manufacturer, reg: x.registration, owner: x.registered_owner,
             photo: x.url_photo, thumb: x.url_photo_thumbnail };
  } catch (e) { if (e.status === 404) return null; throw e; }
}

async function lookupPhoto(a) {
  const pick = j => {
    const p = j?.photos?.[0];
    return p ? { thumb: p.thumbnail?.src, large: p.thumbnail_large?.src || p.thumbnail?.src, link: p.link, by: p.photographer, site: 'Planespotters.net' } : null;
  };
  try {
    let p = pick(await fetchJSON(`https://api.planespotters.net/pub/photos/hex/${a.hex}`));
    if (!p && a.reg) p = pick(await fetchJSON(`https://api.planespotters.net/pub/photos/reg/${encodeURIComponent(a.reg)}`));
    if (p) return p;
  } catch { /* fall through */ }
  const e = enrich.ac.get(a.hex);
  if (e && e.thumb) return { thumb: e.thumb, large: e.photo || e.thumb, link: e.photo || null, by: '', site: 'airport-data.com' };
  return null;
}

function want(kind, id, fn) {
  const key = kind + ':' + id;
  if (enrich[kind].has(id) || enrich.pending.has(key)) return;
  enrich.pending.add(key);
  enrich.queue.push(async () => {
    try { enrich[kind].set(id, await fn()); saveCache(); scheduleRender(); }
    catch { /* network trouble: leave uncached so it retries later */ }
    finally { enrich.pending.delete(key); }
  });
  pump();
}
let running = 0;
function pump() {
  while (running < 2 && enrich.queue.length) {
    const job = enrich.queue.shift(); running++;
    job().finally(() => { running--; setTimeout(pump, 250); });
  }
}
function enrichTop(list) {
  if (cfg.demo) return;
  for (const a of list.slice(0, 10)) {
    if (!a.reg || !a.type) want('ac', a.hex, () => lookupAircraft(a.hex));
    if (a.callsign && !a.ground) want('route', a.callsign.toUpperCase(), () => lookupRoute(a));
    // photos wait for the aircraft record when it might supply a fallback
    if (!a.reg && !enrich.ac.has(a.hex)) continue;
    want('photo', a.hex, () => lookupPhoto({ ...a, reg: a.reg || enrich.ac.get(a.hex)?.reg }));
  }
}

/* ---------- demo traffic ---------- */
const DEMO = [
  { hex:'a1b2c3', callsign:'UAL1734', reg:'N37522', type:'B39M', alt:6200, vrate:1800, gs:240, from:['IAH','Houston'], to:['DEN','Denver'], airline:'United Airlines' },
  { hex:'a4d5e6', callsign:'SWA2291', reg:'N8710M', type:'B38M', alt:11000, vrate:-1100, gs:290, from:['MCO','Orlando'], to:['HOU','Houston'], airline:'Southwest Airlines' },
  { hex:'a7f8a9', callsign:'AAL2410', reg:'N953NN', type:'B738', alt:34000, vrate:0, gs:452, from:['MIA','Miami'], to:['PHX','Phoenix'], airline:'American Airlines' },
  { hex:'ab0c1d', callsign:'N172SP', reg:'N172SP', type:'C172', alt:2400, vrate:0, gs:105, category:'A1' },
  { hex:'ac2e3f', callsign:'FDX1407', reg:'N851FD', type:'B763', alt:23000, vrate:-1500, gs:380, from:['MEM','Memphis'], to:['IAH','Houston'], airline:'FedEx' },
  { hex:'ad4a5b', callsign:'LIFE2', reg:'N912LF', type:'EC45', alt:1500, vrate:0, gs:120, category:'A7' },
];
const demoState = new Map();
function demoTraffic(lat, lon) {
  const t = Date.now() / 1000, out = [];
  DEMO.forEach((d, i) => {
    if (!demoState.has(d.hex)) demoState.set(d.hex, { phase: i * 1.7, hdg: (i * 67 + 20) % 360 });
    const s = demoState.get(d.hex);
    const r = cfg.radiusMi * (0.25 + 0.6 * ((Math.sin(t / 40 + s.phase) + 1) / 2));
    const ang = rad((s.hdg + t * (2 + i)) % 360);
    const dLat = (r * Math.cos(ang)) / 69, dLon = (r * Math.sin(ang)) / (69 * Math.cos(rad(lat)));
    if (d.from && !enrich.route.has(d.callsign)) enrich.route.set(d.callsign, { from: { code: d.from[0], city: d.from[1] }, to: { code: d.to[0], city: d.to[1] }, airline: d.airline, via: 'demo' });
    out.push({ ...d, lat: lat + dLat, lon: lon + dLon, track: (deg(ang) + 90) % 360, ground: false, desc: '', op: d.airline || '', squawk: i === 5 ? '1200' : String(4000 + i * 111), category: d.category || 'A3', seenPos: 1, emergency: '' });
  });
  return out;
}

/* ---------- location ---------- */
let here = null, watchId = null, locError = null;
function startLocation() {
  if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  locError = null;
  if (cfg.locMode === 'fixed') {
    here = (cfg.lat != null && cfg.lon != null) ? { lat: cfg.lat, lon: cfg.lon, fixed: true } : null;
    if (!here) locError = 'Set a fixed latitude and longitude in Settings.';
    return;
  }
  if (!('geolocation' in navigator)) { locError = 'This browser can’t share your location. Set a fixed point in Settings.'; return; }
  if (!window.isSecureContext) { locError = 'Location needs HTTPS. Open the app from its https:// link, or set a fixed point in Settings.'; return; }
  watchId = navigator.geolocation.watchPosition(
    p => { const first = !here; here = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }; locError = null; if (first) poll(true); },
    e => { locError = e.code === 1 ? 'Location permission is off. Allow it for this site, or set a fixed point in Settings.' : 'Couldn’t get your location yet.'; render(); },
    { enableHighAccuracy: false, maximumAge: 30000, timeout: 20000 }
  );
}

/* ---------- state + polling ---------- */
const state = { list: [], label: '', updated: 0, error: null, selected: null, trails: new Map(), feature: 0, wider: 0 };
let pollTimer;
async function poll(now) {
  clearTimeout(pollTimer);
  if (document.hidden && !cfg.kiosk) return;
  if (!here && cfg.demo) here = { lat: cfg.lat ?? 39.8617, lon: cfg.lon ?? -104.6731, fixed: true }; // demo needs a centre
  if (here) {
    try {
      const { list, label } = await getTraffic(here.lat, here.lon);
      const seen = new Set();
      for (const a of list) {
        a.dist = distMi(here.lat, here.lon, a.lat, a.lon);
        a.brg = bearing(here.lat, here.lon, a.lat, a.lon);
        seen.add(a.hex);
        const tr = state.trails.get(a.hex) || []; tr.push([a.lat, a.lon]); if (tr.length > 12) tr.shift(); state.trails.set(a.hex, tr);
      }
      for (const k of state.trails.keys()) if (!seen.has(k)) state.trails.delete(k);
      const inside = list.filter(a => a.dist <= cfg.radiusMi && (cfg.showGround || !a.ground)).sort((x, y) => x.dist - y.dist);
      state.wider = list.length;
      state.list = inside; state.label = label; state.updated = Date.now(); state.error = null;
      enrichTop(inside);
    } catch (e) {
      state.error = e.name === 'AbortError' ? 'timed out' : (e.message === 'Failed to fetch' ? 'blocked or offline' : e.message);
      state.errorSource = e.source || '';
    }
  }
  render();
  pollTimer = setTimeout(poll, cfg.refreshSec * 1000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(true); });

/* ---------- rendering ---------- */
const $ = id => document.getElementById(id);
const PLANE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg>';
const HELI = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h18v1.6H13V7h1a4 4 0 0 1 4 4v1.5h4V14h-4.6A4 4 0 0 1 14 16h-1v2h4v1.6H7V18h4v-2a4 4 0 0 1-4-4H2v-1.5h5.2A4 4 0 0 1 11 7V5.6H3z"/></svg>';
const ARROW = b => `<svg viewBox="0 0 24 24" style="transform:rotate(${Math.round(b)}deg)" aria-hidden="true"><path d="M12 2l6 18-6-4-6 4z"/></svg>`;
const silhouette = a => isHeli(a) ? HELI : PLANE;

let rq;
function scheduleRender() { if (!rq) rq = requestAnimationFrame(() => { rq = null; render(); }); }

function routeHTML(a, big) {
  const r = a.callsign ? enrich.route.get(a.callsign.toUpperCase()) : null;
  if (r && r.from && r.to) {
    const t = big ? `${esc(r.from.city || r.from.code)} → ${esc(r.to.city || r.to.code)}` : '';
    return `<div class="route" title="${t}">${esc(r.from.code)}<span class="arr">→</span>${esc(r.to.code)}${r.to.city ? ` <span style="color:var(--muted);font-weight:500">· ${esc(r.to.city)}</span>` : ''}</div>`;
  }
  const label = a.ground ? 'On the ground' : (a.op ? esc(a.op) : (a.callsign && !cfg.demo ? 'Route unknown' : 'No flight plan'));
  return `<div class="route none">${label}</div>`;
}
function photoHTML(a, size) {
  const p = enrich.photo.get(a.hex);
  if (p && (p.thumb || p.large)) return `<img src="${esc(size === 'large' ? p.large : p.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer-when-downgrade" onerror="this.remove()">`;
  return silhouette(a);
}
function creditHTML(a) {
  const p = enrich.photo.get(a.hex);
  if (!p) return '';
  const who = p.by ? `© ${esc(p.by)}` : 'Photo';
  return p.link ? `<a href="${esc(p.link)}" target="_blank" rel="noopener">${who}</a> · ${esc(p.site)}` : `${who} · ${esc(p.site)}`;
}
const label = a => a.callsign || a.reg || a.hex.toUpperCase();

function stripHTML(a) {
  const sq = ['7500', '7600', '7700'].includes(a.squawk) || a.emergency ? `<span class="sq">${esc(a.squawk || 'EMERG')}</span>` : '';
  const reg = a.reg || enrich.ac.get(a.hex)?.reg || '';
  return `<li><button class="strip${state.selected === a.hex ? ' sel' : ''}" data-hex="${a.hex}" type="button">
    <div class="ph">${photoHTML(a, 'thumb')}</div>
    <div class="mid">
      <div class="cs"><b>${esc(label(a))}</b>${reg && reg !== a.callsign ? `<span class="reg">${esc(reg)}</span>` : ''}${sq}</div>
      ${routeHTML(a)}
      <div class="type">${esc(typeName(a))}</div>
    </div>
    <div class="rt">
      <div class="alt ${trend(a)}">${fmtAlt(a)}${trendArrow(a)}</div>
      <div class="spd">${fmtSpd(a.gs)}</div>
      <div class="dist">${ARROW(a.brg)}${fmtDist(a.dist)} ${cardinal(a.brg)}</div>
    </div></button></li>`;
}

function scopeSVG() {
  const S = 320, C = S / 2, Rpx = C - 22, k = Rpx / cfg.radiusMi;
  const rings = [cfg.radiusMi / 3, (cfg.radiusMi * 2) / 3, cfg.radiusMi];
  let g = `<svg viewBox="0 0 ${S} ${S}" role="img" aria-label="Scope: aircraft positions around you, north up">`;
  rings.forEach((r, i) => {
    g += `<circle class="ring" cx="${C}" cy="${C}" r="${(r * k).toFixed(1)}"/>`;
    const val = metric() ? (r * 1.609).toFixed(r * 1.609 < 10 ? 1 : 0) : (r % 1 ? r.toFixed(1) : r);
    g += `<text class="ringlbl" x="${C + 4}" y="${(C - r * k + 11).toFixed(1)}">${val}${i === 2 ? (metric() ? ' km' : ' mi') : ''}</text>`;
  });
  g += `<text class="card-n" x="${C}" y="13" text-anchor="middle">N</text>`;
  g += `<circle class="me" cx="${C}" cy="${C}" r="4"/>`;
  const toXY = (lat, lon) => {
    const d = distMi(here.lat, here.lon, lat, lon), b = rad(bearing(here.lat, here.lon, lat, lon));
    return [C + Math.sin(b) * d * k, C - Math.cos(b) * d * k];
  };
  const shown = new Set(state.list.slice(0, 5).map(a => a.hex));
  for (const a of state.list) {
    const tr = state.trails.get(a.hex);
    if (tr && tr.length > 1) g += `<polyline class="trail" points="${tr.map(p => toXY(p[0], p[1]).map(n => n.toFixed(1)).join(',')).join(' ')}"/>`;
  }
  for (const a of state.list) {
    const [x, y] = toXY(a.lat, a.lon);
    const h = rad(a.track ?? 0), len = 14;
    const tx = x + Math.sin(h) * len, ty = y - Math.cos(h) * len;
    const sel = state.selected === a.hex;
    const lblRight = x < S - 70;
    g += `<g class="blip ${trend(a)}${sel ? ' sel' : ''}" data-hex="${a.hex}">
      ${sel ? `<circle class="halo" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9"/>` : ''}
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="14" fill="transparent"/>
      ${a.track != null ? `<line class="t" x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${tx.toFixed(1)}" y2="${ty.toFixed(1)}"/>` : ''}
      <rect class="b" x="${(x - 3.5).toFixed(1)}" y="${(y - 3.5).toFixed(1)}" width="7" height="7"/>
      ${shown.has(a.hex) || sel ? `<text x="${(lblRight ? x + 8 : x - 8).toFixed(1)}" y="${(y + 14).toFixed(1)}" text-anchor="${lblRight ? 'start' : 'end'}">${esc(label(a))}</text>` : ''}
    </g>`;
  }
  return g + '</svg>';
}

function statusLine() {
  const el = $('status');
  el.classList.remove('stale', 'err');
  let txt;
  if (locError && !here) { el.classList.add('err'); txt = 'No location'; }
  else if (!here) txt = 'Finding you…';
  else if (state.error) { el.classList.add('err'); txt = `${state.errorSource || 'Data'}: ${state.error}`; }
  else if (!state.updated) txt = 'Loading…';
  else {
    const age = Math.round((Date.now() - state.updated) / 1000);
    if (age > cfg.refreshSec * 3) el.classList.add('stale');
    txt = `${state.label} · ${age < 2 ? 'just now' : age + 's ago'}`;
  }
  el.innerHTML = `<span class="dot"></span>${esc(txt)}`;
}

function noticeHTML() {
  if (locError && !here) return `<div class="notice"><h3>Where are you?</h3><p>${esc(locError)}</p><div class="row"><button class="btn primary" data-act="retryLoc" type="button">Try location again</button><button class="btn" data-act="settings" type="button">Set a fixed point</button><button class="btn" data-act="demo" type="button">Show demo traffic</button></div></div>`;
  if (state.error && !state.list.length) return `<div class="notice"><h3>Can’t reach the flight data</h3><p>${cfg.source === 'local' ? `Your receiver at ${esc(cfg.localUrl)} didn’t answer (${esc(state.error)}). Check the URL in Settings.` : `The free ADS-B networks didn’t answer (${esc(state.error)}). This is usually brief; the app keeps retrying every ${cfg.refreshSec} seconds.`}</p><div class="row"><button class="btn" data-act="retry" type="button">Retry now</button><button class="btn" data-act="demo" type="button">Show demo traffic</button></div></div>`;
  if (here && state.updated && !state.list.length) return `<div class="notice"><h3>Quiet skies</h3><p>No aircraft within ${fmtDist(cfg.radiusMi)} right now${state.wider ? `; ${state.wider} more just outside` : ''}. The list fills in as soon as something comes into range.</p></div>`;
  return '';
}

function featureHTML() {
  if (!state.list.length) {
    const t = new Date();
    return `<div class="quiet"><div><div class="clock num">${t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div><p>${here ? `Nothing within ${fmtDist(cfg.radiusMi)}` : esc(locError || 'Waiting for location')}</p></div></div>`;
  }
  const a = state.list[state.feature % state.list.length];
  const r = a.callsign ? enrich.route.get(a.callsign.toUpperCase()) : null;
  return `<div class="fx-hero">${enrich.photo.get(a.hex)?.large ? photoHTML(a, 'large') : `<div class="ph">${silhouette(a)}</div>`}<div class="credit">${creditHTML(a)}</div></div>
    <div class="fx-body">
      <div style="min-width:0">
        <div class="cs"><b>${esc(label(a))}</b><span class="reg">${esc(a.reg || '')}</span></div>
        ${r && r.from ? `<div class="route">${esc(r.from.city || r.from.code)}<span class="arr">→</span>${esc(r.to.city || r.to.code)}</div>` : routeHTML(a)}
        <div class="type">${esc(typeName(a))}${r?.airline ? ' · ' + esc(r.airline) : (a.op ? ' · ' + esc(a.op) : '')}</div>
      </div>
      <div class="rt"><div class="alt ${trend(a)}">${fmtAlt(a)}${trendArrow(a)}</div><div class="dist">${ARROW(a.brg)}${fmtDist(a.dist)} ${cardinal(a.brg)} · ${fmtSpd(a.gs)}</div></div>
    </div>`;
}

function detailHTML(a) {
  const r = a.callsign ? enrich.route.get(a.callsign.toUpperCase()) : null;
  const e = enrich.ac.get(a.hex) || {};
  const reg = a.reg || e.reg || '';
  const operator = r?.airline || a.op || e.owner || '';
  const fact = (k, v) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
  return `<div class="grab"></div>
    <div class="hero">${enrich.photo.get(a.hex) ? photoHTML(a, 'large') : `<div class="ph">${silhouette(a)}</div>`}</div>
    ${creditHTML(a) ? `<div class="credit">${creditHTML(a)}</div>` : ''}
    <div class="dhead"><div><h2>${esc(label(a))}</h2><div class="sub">${esc([operator, typeName(a)].filter(Boolean).join(' · '))}</div></div>
      <button class="iconbtn" data-act="close" aria-label="Close details" type="button"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    ${r && r.from ? `<div class="droute">
      <div class="ap"><b>${esc(r.from.code)}</b><span>${esc(r.from.city || '')}</span><span>${esc(r.from.name || '')}</span></div>
      <svg class="plane" viewBox="0 0 24 24" style="transform:rotate(90deg)"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg>
      <div class="ap r"><b>${esc(r.to.code)}</b><span>${esc(r.to.city || '')}</span><span>${esc(r.to.name || '')}</span></div></div>` : ''}
    <dl class="facts">
      ${fact('Altitude', fmtAlt(a) + trendArrow(a))}
      ${fact('Vertical', fmtRate(a.vrate))}
      ${fact('Speed', fmtSpd(a.gs))}
      ${fact('Heading', a.track != null ? Math.round(a.track) + '°' : '—')}
      ${fact('From you', `${fmtDist(a.dist)} ${cardinal(a.brg)}`)}
      ${fact('Squawk', esc(a.squawk || '—'))}
      ${fact('Registration', esc(reg || '—'))}
      ${fact('Type code', esc(a.type || e.icaoType || '—'))}
      ${fact('Mode S', esc(a.hex.toUpperCase()))}
    </dl>
    <div class="links">
      <a href="https://globe.airplanes.live/?icao=${a.hex}" target="_blank" rel="noopener">Track on map</a>
      ${a.callsign ? `<a href="https://www.flightaware.com/live/flight/${encodeURIComponent(a.callsign)}" target="_blank" rel="noopener">FlightAware</a>` : ''}
      ${reg ? `<a href="https://www.planespotters.net/search?q=${encodeURIComponent(reg)}" target="_blank" rel="noopener">More photos</a>` : ''}
    </div>
    ${r && r.via !== 'demo' ? `<p class="fine">Route comes from a callsign database (${esc(r.via)}) and can be out of date for some flights.${r.plausible === false ? ' This one doesn’t match the aircraft’s position well.' : ''}</p>` : ''}`;
}

function render() {
  document.body.classList.toggle('kiosk', !!cfg.kiosk);
  $('radiusLbl').textContent = fmtDist(cfg.radiusMi).replace('.0 ', ' ');
  statusLine();
  $('count').textContent = state.list.length ? `${state.list.length} aircraft` : '';
  $('scope').innerHTML = here ? scopeSVG() + `<div class="legend">north up</div><div class="src">${here.fixed ? 'fixed point' : 'your location'}</div>` : '';
  $('scope').hidden = !here;
  $('notice').innerHTML = noticeHTML();
  const max = cfg.kiosk ? 5 : 40;
  $('strips').innerHTML = state.list.slice(0, max).map(stripHTML).join('');
  if (cfg.kiosk) $('feature').innerHTML = featureHTML();
  if (state.selected) {
    const a = state.list.find(x => x.hex === state.selected);
    if (a) $('sheetInner').innerHTML = detailHTML(a);
  }
}

/* ---------- interaction ---------- */
function openDetail(hex) {
  state.selected = hex;
  const a = state.list.find(x => x.hex === hex); if (!a) return;
  if (!cfg.demo) {
    want('ac', a.hex, () => lookupAircraft(a.hex));
    if (a.callsign) want('route', a.callsign.toUpperCase(), () => lookupRoute(a));
    want('photo', a.hex, () => lookupPhoto({ ...a, reg: a.reg || enrich.ac.get(a.hex)?.reg }));
  }
  $('sheetInner').innerHTML = detailHTML(a);
  $('sheet').classList.add('open'); $('scrim').classList.add('open'); $('sheet').setAttribute('aria-hidden', 'false');
  render();
}
function closeDetail() {
  state.selected = null;
  $('sheet').classList.remove('open'); $('scrim').classList.remove('open'); $('sheet').setAttribute('aria-hidden', 'true');
  render();
}
document.addEventListener('click', ev => {
  const s = ev.target.closest('[data-hex]');
  if (s && !cfg.kiosk) { openDetail(s.dataset.hex); return; }
  const act = ev.target.closest('[data-act]')?.dataset.act;
  if (act === 'close') closeDetail();
  if (act === 'settings') openSettings();
  if (act === 'retry') poll(true);
  if (act === 'retryLoc') { startLocation(); render(); }
  if (act === 'demo') { cfg.demo = true; store(LS_KEY, cfg); poll(true); }
});
$('scrim').addEventListener('click', closeDetail);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && state.selected) closeDetail(); });

/* settings dialog */
const dlg = $('settings');
function syncSettingsVis() {
  $('f-local').hidden = $('s-source').value !== 'local';
  $('f-fixed').hidden = $('s-loc').value !== 'fixed';
  $('s-radiusVal').textContent = `${$('s-radius').value} mi`;
  $('s-refreshVal').textContent = `${$('s-refresh').value} s`;
}
function openSettings() {
  $('s-source').value = cfg.source; $('s-localUrl').value = cfg.localUrl;
  $('s-radius').value = cfg.radiusMi; $('s-refresh').value = cfg.refreshSec;
  $('s-loc').value = cfg.locMode; $('s-lat').value = cfg.lat ?? ''; $('s-lon').value = cfg.lon ?? '';
  $('s-units').value = cfg.units; $('s-ground').checked = cfg.showGround; $('s-kiosk').checked = cfg.kiosk; $('s-demo').checked = cfg.demo;
  syncSettingsVis();
  if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
}
['s-source', 's-loc', 's-radius', 's-refresh'].forEach(id => $(id).addEventListener('input', syncSettingsVis));
$('settingsBtn').addEventListener('click', openSettings);
$('s-cancel').addEventListener('click', () => dlg.close());
$('s-here').addEventListener('click', () => {
  const b = $('s-here');
  if (!navigator.geolocation || !window.isSecureContext) { b.textContent = 'Location unavailable here'; return; }
  b.textContent = 'Locating…';
  navigator.geolocation.getCurrentPosition(p => {
    $('s-loc').value = 'fixed'; $('s-lat').value = p.coords.latitude.toFixed(5); $('s-lon').value = p.coords.longitude.toFixed(5);
    b.textContent = 'Use where I am now'; syncSettingsVis();
  }, () => { b.textContent = 'Couldn’t get location'; }, { timeout: 15000 });
});
$('settingsForm').addEventListener('submit', e => {
  e.preventDefault();
  const prevLoc = [cfg.locMode, cfg.lat, cfg.lon].join();
  cfg.source = $('s-source').value; cfg.localUrl = $('s-localUrl').value.trim() || DEFAULTS.localUrl;
  cfg.radiusMi = +$('s-radius').value; cfg.refreshSec = +$('s-refresh').value;
  cfg.locMode = $('s-loc').value; cfg.lat = num($('s-lat').value); cfg.lon = num($('s-lon').value);
  cfg.units = $('s-units').value; cfg.showGround = $('s-ground').checked; cfg.kiosk = $('s-kiosk').checked; cfg.demo = $('s-demo').checked;
  store(LS_KEY, cfg);
  dlg.close();
  if ([cfg.locMode, cfg.lat, cfg.lon].join() !== prevLoc) { here = null; startLocation(); }
  state.list = []; state.updated = 0; state.trails.clear();
  if (cfg.kiosk) wake();
  poll(true);
});

/* kiosk extras: rotate featured aircraft, keep screen on, long-press corner for settings */
setInterval(() => { if (cfg.kiosk && state.list.length > 1) { state.feature++; render(); } }, 12000);
setInterval(() => { statusLine(); if (cfg.kiosk && !state.list.length) render(); }, 1000);
let lock;
async function wake() { try { if ('wakeLock' in navigator && cfg.kiosk) lock = await navigator.wakeLock.request('screen'); } catch { /* not granted */ } }
document.addEventListener('visibilitychange', () => { if (!document.hidden && cfg.kiosk) wake(); });

/* ---------- boot ---------- */
if ('serviceWorker' in navigator && window.isSecureContext && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* preview frames can't register; fine */ });
}
startLocation();
if (cfg.kiosk) wake();
render();
poll(true);
})();
