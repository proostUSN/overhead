/* Overhead — aircraft near you from free ADS-B networks or your own receiver.
   No build step. Works as a PWA on a phone and as a kiosk page on a Raspberry Pi. */
(() => {
'use strict';

/* ---------- settings ---------- */
const DEFAULTS = {
  source: 'auto',            // auto | airplaneslive | adsblol | adsbfi | local
  localUrl: '/tar1090/data/aircraft.json',
  relay: '',                 // relay that lets the page read the free feeds (nas/ for a home server)
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

// The shared home relay (Synology + Tailscale Funnel). Everyone who opens the app uses it unless they set their own.
const DEFAULT_RELAY = 'https://overhead-relay.tail71c8a7.ts.net';
const cfg = Object.assign({}, DEFAULTS, store(LS_KEY) || {});
if (!cfg.relay) cfg.relay = DEFAULT_RELAY;
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
if (qp.has('relay')) cfg.relay = qp.get('relay');
const viaRelay = url => cfg.relay ? `${cfg.relay.replace(/\/+$/, '')}/?url=${encodeURIComponent(url)}` : url;

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
const fmtRate = v => v == null ? '—' : metric() ? `${Math.round(v * 0.00508 * 10) / 10} m/s` : `${v > 0 ? '+' : ''}${(Math.round(v / 10) * 10).toLocaleString()} fpm`;
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
// Your exact position never leaves the phone: queries use a point rounded to 0.01° (under a mile),
// with the search circle widened to cover the difference; exact distances are worked out on the device.
const nmFor = mi => Math.min(250, Math.max(1, Math.ceil(mi / MI_PER_NM) + 2));
const SOURCES = {
  airplaneslive: { label: 'airplanes.live', url: (lat, lon, mi) => viaRelay(`https://api.airplanes.live/v2/point/${lat.toFixed(2)}/${lon.toFixed(2)}/${nmFor(mi)}`) },
  adsblol:       { label: 'adsb.lol',       url: (lat, lon, mi) => viaRelay(`https://api.adsb.lol/v2/point/${lat.toFixed(2)}/${lon.toFixed(2)}/${nmFor(mi)}`) },
  adsbfi:        { label: 'adsb.fi',        url: (lat, lon, mi) => viaRelay(`https://opendata.adsb.fi/api/v2/lat/${lat.toFixed(2)}/lon/${lon.toFixed(2)}/dist/${nmFor(mi)}`) },
  local:         { label: 'your receiver',  url: () => cfg.localUrl },
};
const AUTO_ORDER = ['adsblol', 'adsbfi', 'airplaneslive']; // airplanes.live currently refuses relays
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
  if (cfg.source !== 'local' && !cfg.relay) { const e = new Error('needs relay'); e.needsRelay = true; e.source = 'Live data'; throw e; }
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
const CACHE_KEY = 'overhead.cache.v4'; // bumped: drop routes cached from the older source
const enrich = { route: new Map(), ac: new Map(), photo: new Map(), airline: new Map(), pending: new Set(), queue: [] };
(function loadCache() {
  const c = store(CACHE_KEY); if (!c) return;
  const now = Date.now();
  for (const k of ['route', 'ac', 'photo', 'airline']) for (const [id, v] of Object.entries(c[k] || {})) if (v && v.exp > now) enrich[k].set(id, v.data);
})();
let saveTimer;
function saveCache() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const out = {}; const now = Date.now();
    const ttl = { route: 6 * 3600e3, ac: 7 * 86400e3, photo: 7 * 86400e3, airline: 30 * 86400e3 };
    for (const k of ['route', 'ac', 'photo', 'airline']) {
      out[k] = {}; const entries = [...enrich[k].entries()].slice(-300);
      for (const [id, data] of entries) out[k][id] = { exp: now + ttl[k], data };
    }
    store(CACHE_KEY, out);
  }, 1500);
}

async function lookupRoute(a) {
  const cs = a.callsign.toUpperCase();
  // 1) adsb.lol route database, checked against the aircraft's current position (via the relay)
  if (cfg.relay) try {
    const j = await fetchJSON(viaRelay(`https://api.adsb.lol/api/0/route/${encodeURIComponent(cs)}/${a.lat.toFixed(2)}/${a.lon.toFixed(2)}`));
    const aps = j?._airports;
    if (aps && aps.length >= 2 && j.plausible !== false && j.plausible !== 0) {
      const ap = p => ({ code: p.iata || p.icao, icao: p.icao, name: p.name, city: p.location, lat: p.lat, lon: p.lon });
      return { stops: aps.map(ap), airline: '', airlineIcao: j.airline_code || '', via: 'adsb.lol' };
    }
  } catch (e) { if (e.status && e.status !== 404) throw e; }
  // 2) adsbdb callsign database
  try {
    const j = await fetchJSON(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(cs)}`);
    const fr = j?.response?.flightroute;
    if (fr && fr.origin && fr.destination) {
      const ap = p => ({ code: p.iata_code || p.icao_code, icao: p.icao_code, name: p.name, city: p.municipality, lat: p.latitude, lon: p.longitude });
      const stops = [fr.origin, fr.midpoint, fr.destination].filter(Boolean).map(ap);
      return { stops, airline: fr.airline?.name || '', airlineIata: fr.airline?.iata || '', airlineIcao: fr.airline?.icao || '', flightNo: fr.callsign_iata || '', via: 'adsbdb' };
    }
  } catch (e) { if (e.status && e.status !== 404) throw e; }
  return null;
}

// Corrections where the airline database is out of date (codes reassigned to a newer airline).
const AIRLINE_FIXES = {
  SCW: { name: 'SkyWest Charter', iata: '', icao: 'SCW' },   // listed as Malmö Aviation, a defunct Swedish airline
};
async function lookupAirline(icao) {
  if (AIRLINE_FIXES[icao]) return AIRLINE_FIXES[icao];
  try {
    const j = await fetchJSON(`https://api.adsbdb.com/v0/airline/${encodeURIComponent(icao)}`);
    const x = Array.isArray(j?.response) ? j.response[0] : j?.response;
    return x && x.name ? { name: x.name, iata: x.iata || '', icao: x.icao || icao } : null;
  } catch (e) { if (e.status === 404) return null; throw e; }
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
    if (/^[A-Z]{3}\d/.test(a.callsign)) want('airline', a.callsign.slice(0, 3), () => lookupAirline(a.callsign.slice(0, 3)));
    // photos wait for the aircraft record when it might supply a fallback
    if (!a.reg && !enrich.ac.has(a.hex)) continue;
    want('photo', a.hex, () => lookupPhoto({ ...a, reg: a.reg || enrich.ac.get(a.hex)?.reg }));
  }
}

/* ---------- demo traffic ---------- */
const DEMO = [
  { hex:'a1b2c3', callsign:'UAL1734', reg:'N37522', type:'B39M', alt:6200, vrate:1800, gs:240, from:['IAH','Houston','George Bush Intercontinental',29.9844,-95.3414], to:['DEN','Denver','Denver International',39.8617,-104.6731], airline:'United Airlines', ai:'UA', ao:'UAL', fno:'UA1734' },
  { hex:'a4d5e6', callsign:'SWA2291', reg:'N8710M', type:'B38M', alt:11000, vrate:-1100, gs:290, from:['MCO','Orlando','Orlando International',28.4294,-81.3089], to:['AUS','Austin','Austin-Bergstrom International',30.1945,-97.6699], airline:'Southwest Airlines', ai:'WN', ao:'SWA', fno:'WN2291' },
  { hex:'a7f8a9', callsign:'AAL2410', reg:'N953NN', type:'B738', alt:34000, vrate:0, gs:452, from:['MIA','Miami','Miami International',25.7959,-80.287], to:['PHX','Phoenix','Phoenix Sky Harbor',33.4342,-112.0116], airline:'American Airlines', ai:'AA', ao:'AAL', fno:'AA2410' },
  { hex:'ab0c1d', callsign:'N172SP', reg:'N172SP', type:'C172', alt:2400, vrate:0, gs:105, category:'A1' },
  { hex:'ac2e3f', callsign:'FDX1407', reg:'N851FD', type:'B763', alt:23000, vrate:-1500, gs:380, from:['MEM','Memphis','Memphis International',35.0424,-89.9767], to:['SAT','San Antonio','San Antonio International',29.5337,-98.4698], airline:'FedEx', ai:'FX', ao:'FDX', fno:'FX1407' },
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
    const apd = x => ({ code: x[0], city: x[1], name: x[2], lat: x[3], lon: x[4] });
    if (d.from && !enrich.route.has(d.callsign)) enrich.route.set(d.callsign, { from: apd(d.from), to: apd(d.to), airline: d.airline, airlineIata: d.ai, airlineIcao: d.ao, flightNo: d.fno, via: 'demo' });
    out.push({ ...d, lat: lat + dLat, lon: lon + dLon, track: (deg(ang) + 90) % 360, ground: false, desc: '', op: d.airline || '', squawk: d.type === 'C172' ? '1200' : String(4000 + i * 111), category: d.category || 'A3', seenPos: 1, emergency: '' });
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
    p => { const first = !here; here = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, altM: p.coords.altitude }; locError = null; if (first) poll(true); },
    e => { locError = e.code === 1 ? 'Location permission is off. Allow it for this site, or set a fixed point in Settings.' : 'Couldn’t get your location yet.'; render(); },
    { enableHighAccuracy: false, maximumAge: 30000, timeout: 20000 }
  );
}

/* ---------- state + polling ---------- */
const state = { list: [], label: '', updated: 0, error: null, selected: null, trails: new Map(), feature: 0, wider: 0 };
let pollTimer;
async function poll(now) {
  clearTimeout(pollTimer);
  if (document.hidden && !cfg.kiosk && !now) return; // background tabs pause between refreshes
  if (!here && cfg.demo) here = { lat: cfg.lat ?? 30.6, lon: cfg.lon ?? -97.2, fixed: true }; // demo needs a centre
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
      if (inside.length) state.last = { name: flightLabel(inside[0]), at: Date.now() };
      state.all = list.filter(a => !a.ground);                   // everything fetched (a little beyond the radius), for the sky view
      state.list = inside; state.label = label; state.updated = Date.now(); state.error = null; state.needsRelay = false;
      enrichTop(inside);
    } catch (e) {
      state.error = e.name === 'AbortError' ? 'timed out' : (e.message === 'Failed to fetch' ? 'blocked or offline' : e.message);
      state.errorSource = e.source || ''; state.needsRelay = !!e.needsRelay;
    }
  }
  render();
  pollTimer = setTimeout(poll, cfg.refreshSec * 1000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(true); });


/* ---------- airports: infer departures and arrivals ---------- */
// Major airports (OurAirports, public domain): [iata, lat, lon, city]. Loaded once, cached by the service worker.
let AIRPORTS = [];
fetch('airports.json').then(r => r.ok ? r.json() : []).then(list => { AIRPORTS = list.map(([code, lat, lon, city]) => ({ code, lat, lon, city })); scheduleRender(); }).catch(() => {});

// The airport a climbing aircraft just left (behind it), or a descending one is heading for (ahead of it).
// Scored by how well the distance fits a normal climb/descent (~300 ft per mile) and how well the
// heading lines up; airports the route database lists for this flight get a strong preference.
function airportFor(a, mode, preferred = []) {
  if (!AIRPORTS.length || a.alt == null) return null;
  const expect = a.alt / 300;                                  // miles from the runway on a 3° path
  const maxMi = Math.min(90, Math.max(15, expect * 2 + 10));
  const want = new Set(preferred.map(x => x && x.code).filter(Boolean));
  let best = null, bestScore = Infinity;
  for (const ap of AIRPORTS) {
    if (Math.abs(ap.lat - a.lat) > 1.5) continue;
    const d = distMi(ap.lat, ap.lon, a.lat, a.lon);
    if (d > maxMi) continue;
    let diff = 0;
    if (a.track != null && d > 3) {
      const b = mode === 'from' ? bearing(ap.lat, ap.lon, a.lat, a.lon) : bearing(a.lat, a.lon, ap.lat, ap.lon);
      diff = Math.abs(((b - a.track) + 540) % 360 - 180);
      if (diff > 100) continue;
    }
    let score = Math.abs(d - expect) + diff * 0.4;
    if (want.has(ap.code)) score -= 25;                         // the database says this flight serves it
    if (score < bestScore) { bestScore = score; best = ap; }
  }
  return best;
}
// Fill in the leg from what the aircraft is doing: climbing out = departed the airport behind it,
// descending = arriving at the airport ahead. Uses the database's other stops for the far end when they fit.
function inferLeg(a, r) {
  if (a.ground || a.alt == null || a.alt > 18000 || a.vrate == null || Math.abs(a.vrate) < 400) return null;
  const mode = a.vrate > 0 ? 'from' : 'to';
  const ap = airportFor(a, mode, r?.stops || (r?.from ? [r.from, r.to] : []));
  if (!ap) return null;
  const stops = (r?.stops || (r?.from ? [r.from, r.to] : [])).filter(x => x && x.lat != null && x.code !== ap.code);
  let other = null, bestDiff = 60;
  for (const st of stops) {
    const b = mode === 'from' ? bearing(ap.lat, ap.lon, st.lat, st.lon) : bearing(st.lat, st.lon, ap.lat, ap.lon);
    const diff = a.track == null ? 0 : Math.abs(((b - a.track) + 540) % 360 - 180);
    if (diff < bestDiff) { bestDiff = diff; other = st; }
  }
  return mode === 'from' ? { from: ap, to: other, mode } : { from: other, to: ap, mode };
}

/* ---------- sky: colour, sun, moon, stars and clouds follow the real sky at your location ---------- */
function horizontal(ra, dec, lat, lon, d) {
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24;
  const ha = rad(gmst * 15 + lon) - ra, φ = rad(lat);
  const alt = Math.asin(Math.sin(φ) * Math.sin(dec) + Math.cos(φ) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(φ) - Math.sin(φ) * Math.cos(ha));
  return { alt: deg(alt), az: (deg(az) + 360) % 360 };
}
const jDays = (date = new Date()) => date.getTime() / 86400000 + 2440587.5 - 2451545.0;
function sunPos(lat, lon, date) {
  const d = jDays(date);
  const g = rad((357.529 + 0.98560028 * d) % 360), q = (280.459 + 0.98564736 * d) % 360;
  const L = rad((q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) % 360), e = rad(23.439 - 0.00000036 * d);
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  return { ...horizontal(ra, dec, lat, lon, d), eclLon: L };
}
function moonPos(lat, lon, date) {
  const d = jDays(date), e = rad(23.439);
  const Lm = rad((218.316 + 13.176396 * d) % 360), M = rad((134.963 + 13.064993 * d) % 360), F = rad((93.272 + 13.229350 * d) % 360);
  const λ = Lm + rad(6.289) * Math.sin(M), β = rad(5.128) * Math.sin(F);
  const ra = Math.atan2(Math.sin(λ) * Math.cos(e) - Math.tan(β) * Math.sin(e), Math.cos(λ));
  const dec = Math.asin(Math.sin(β) * Math.cos(e) + Math.cos(β) * Math.sin(e) * Math.sin(λ));
  const elong = λ - sunPos(lat, lon, date).eclLon;              // angle from the sun → phase
  return { ...horizontal(ra, dec, lat, lon, d), lit: (1 - Math.cos(elong)) / 2, waxing: Math.sin(elong) > 0 };
}
const sunElevation = (lat, lon, date) => sunPos(lat, lon, date).alt;
function skyPhase() {
  const p = here || { lat: 30, lon: -95 };
  const el = sunElevation(p.lat, p.lon);
  return el > 8 ? 'day' : el > -7 ? 'dusk' : 'night';
}
// Screen placement: facing south, east on the left and west on the right. The horizon is the bottom
// edge and straight up is mid-screen, so the sun and moon sit in the open sky below the card.
function skyXY(az, alt) {
  const x = 50 + Math.max(-44, Math.min(44, ((az - 180) / 90) * 40));
  const y = 97 - Math.max(-3, alt) / 90 * 44;
  return [x, y];
}
let starsBuilt = false;
function paintSky() {
  const sky = $('sky'); if (!sky) return;
  const p = here || { lat: 30, lon: -95 }, now = new Date();
  const sun = sunPos(p.lat, p.lon, now), moon = moonPos(p.lat, p.lon, now);
  if (!starsBuilt) {
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    sky.querySelector('.stars').innerHTML = Array.from({ length: 140 }, () => {
      const sz = rnd() < 0.12 ? 2.2 : rnd() < 0.5 ? 1.4 : 1;
      return `<i style="left:${(rnd() * 100).toFixed(2)}%;top:${(rnd() * 72).toFixed(2)}%;width:${sz}px;height:${sz}px;animation-delay:${(rnd() * 6).toFixed(1)}s;opacity:${(0.35 + rnd() * 0.65).toFixed(2)}"></i>`;
    }).join('');
    starsBuilt = true;
  }
  // stars fade in as the sun drops below the horizon
  sky.style.setProperty('--stars', Math.max(0, Math.min(1, (-sun.alt - 2) / 10)).toFixed(2));
  const s = sky.querySelector('.sun'), m = sky.querySelector('.moon');
  const [sx, sy] = skyXY(sun.az, sun.alt);
  s.style.left = sx + '%'; s.style.top = sy + '%'; s.style.opacity = sun.alt > -3 ? (sun.alt < 4 ? 0.75 : 1) : 0;
  const [mx, my] = skyXY(moon.az, moon.alt);
  m.style.left = mx + '%'; m.style.top = my + '%';
  m.style.opacity = moon.alt > -1 ? (sun.alt > 8 ? 0.45 : 1) : 0;
  // phase: a shadow disc slides across; waxing lit on the right (northern hemisphere view)
  const off = (moon.waxing ? -1 : 1) * moon.lit * 100;
  m.querySelector('.shade').style.transform = `translateX(${off.toFixed(0)}%)`;
  m.title = `Moon ${Math.round(moon.lit * 100)}% lit`;
}

/* ---------- card building blocks ---------- */
const $ = id => document.getElementById(id);
const PLANE_PATH = 'M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z';
const HELI_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h18v1.6H13V7h1a4 4 0 0 1 4 4v1.5h4V14h-4.6A4 4 0 0 1 14 16h-1v2h4v1.6H7V18h4v-2a4 4 0 0 1-4-4H2v-1.5h5.2A4 4 0 0 1 11 7V5.6H3z"/></svg>';
const planeSVG = (rot = 0) => `<svg viewBox="0 0 24 24" aria-hidden="true" style="transform:rotate(${rot}deg)"><path d="${PLANE_PATH}"/></svg>`;
const ARROW = b => `<svg class="brg" viewBox="0 0 24 24" style="transform:rotate(${Math.round(b)}deg)" aria-hidden="true"><path d="M12 2l6 18-6-4-6 4z"/></svg>`;

// A flight number can cover several legs (e.g. SLC → IAH → SLC). Pick the leg this aircraft is
// actually flying: the one whose path it sits on and whose destination it's heading toward.
function pickLeg(stops, a) {
  if (stops.length < 3) return [stops[0], stops[stops.length - 1]];
  let best = null, bestScore = Infinity;
  for (let i = 0; i < stops.length - 1; i++) {
    const f = stops[i], t = stops[i + 1];
    if (f.lat == null || t.lat == null) continue;
    const dF = distMi(f.lat, f.lon, a.lat, a.lon), dT = distMi(a.lat, a.lon, t.lat, t.lon);
    let score = dF + dT - distMi(f.lat, f.lon, t.lat, t.lon);          // miles off the direct path
    if (a.track != null && dT > 5) {                                      // pointing away from this destination?
      const diff = Math.abs(((bearing(a.lat, a.lon, t.lat, t.lon) - a.track) + 540) % 360 - 180);
      score += diff * 2;
    }
    if (a.vrate != null) {                                                // near an airport: climbing = leaving it
      if (dT < 40 && a.vrate > 300) score += 500;                         // climbing near this leg's destination
      if (dF < 40 && a.vrate < -300) score += 500;                        // descending near this leg's origin
    }
    if (score < bestScore) { bestScore = score; best = [f, t]; }
  }
  return best || [stops[0], stops[1]];
}
function routeOf(a) {
  const r = a.callsign ? enrich.route.get(a.callsign.toUpperCase()) : null;
  if (!r || !r.stops) return r;
  const [from, to] = pickLeg(r.stops, a);
  return { ...r, from, to };
}
const airlineIcaoOf = a => routeOf(a)?.airlineIcao || (/^[A-Z]{3}\d/.test(a.callsign) ? a.callsign.slice(0, 3) : '');
const airlineOf = a => { const i = airlineIcaoOf(a); return i ? enrich.airline.get(i) : null; };
const isAirline = a => !!(routeOf(a)?.airline || /^[A-Z]{3}\d/.test(a.callsign));
function flightLabel(a) {
  const r = routeOf(a);
  const al = airlineOf(a);
  const fromIcao = al?.iata && /^[A-Z]{3}\d/.test(a.callsign) ? al.iata + a.callsign.slice(3) : '';
  const f = r?.flightNo || fromIcao || a.callsign || a.reg || a.hex.toUpperCase();
  const m = /^([A-Z0-9]{2,3}?)(\d{1,4}[A-Z]?)$/.exec(f);
  return m && isAirline(a) ? `${m[1]} ${m[2]}` : f;
}
function airlineName(a) {
  const r = routeOf(a), e = enrich.ac.get(a.hex);
  if (r?.airline) return r.airline;
  if (airlineOf(a)?.name) return airlineOf(a).name;
  if (isAirline(a)) return '';          // airliners are often registered to banks/trustees; never show that as the airline
  if (a.op) return titleCase(a.op);
  if (!isAirline(a)) return isHeli(a) ? 'Helicopter' : (e?.owner ? titleCase(e.owner) : 'General aviation');
  return '';
}
function manufacturer(a) {
  const e = enrich.ac.get(a.hex);
  if (e?.manufacturer) return titleCase(e.manufacturer.split(/[ ,]/)[0]);
  return typeName(a).split(' ')[0];
}
function logoHTML(a) {
  const r = routeOf(a), icao = airlineIcaoOf(a), iata = r?.airlineIata || airlineOf(a)?.iata || '';
  const srcs = [];
  if (iata) srcs.push(`https://images.kiwi.com/airlines/128/${iata}.png`);
  if (icao) srcs.push(`https://www.flightaware.com/images/airline_logos/180px/${icao}.png`);
  const badge = isAirline(a)
    ? `<span class="badge code">${esc(icao || iata || '✈')}</span>`
    : `<span class="badge ga">${isHeli(a) ? HELI_SVG : planeSVG(0)}<em>${esc(manufacturer(a))}</em></span>`;
  if (!srcs.length) return badge;
  // The badge sits underneath; the logo fades in on top only once it has actually loaded.
  const known = srcs.find(u => logoOk.has(u));
  if (known) return badge + `<img class="ok" src="${known}" alt="${esc(airlineName(a))} logo">`; // no fade on refresh
  const live = srcs.filter(u => !logoBad.has(u));
  if (!live.length) return badge;
  return badge + `<img src="${live[0]}" data-next="${live.slice(1).join(' ')}" alt="${esc(airlineName(a))} logo" onload="window.__logoOk(this)" onerror="window.__logoFail(this)">`;
}
const logoOk = new Set(), logoBad = new Set();
window.__logoOk = img => { logoOk.add(img.src); img.classList.add('ok'); };
window.__logoFail = img => {
  logoBad.add(img.src);
  const next = (img.dataset.next || '').split(' ').filter(Boolean);
  if (next.length) { img.dataset.next = next.slice(1).join(' '); img.src = next[0]; } else img.remove();
};

function phase(a) { if (a.ground) return 'ground'; const t = trend(a); return t === 'climb' ? 'climb' : t === 'desc' ? 'descend' : 'cruise'; }
const PHASE_LABEL = { climb: 'Climbing', descend: 'Descending', cruise: 'Level', ground: 'On the ground' };

// Callsign databases sometimes list a different leg of the same flight number. Reject a route that
// doesn't fit where the aircraft actually is.
function routePlausible(r, a) {
  if (!r || r.from?.lat == null || r.to?.lat == null) return null;
  const dFrom = distMi(r.from.lat, r.from.lon, a.lat, a.lon), dTo = distMi(a.lat, a.lon, r.to.lat, r.to.lon);
  const total = distMi(r.from.lat, r.from.lon, r.to.lat, r.to.lon);
  if (dFrom + dTo - total > Math.max(150, total * 0.25)) return false;           // far off the path between the airports
  if (!a.ground && a.alt != null && a.alt < 8000 && Math.min(dFrom, dTo) > 40) return false; // low, but near neither airport
  return true;
}
function progressHTML(a) {
  const r = a._leg || routeOf(a);
  const fa = a.callsign ? `<a class="falink" href="https://www.flightaware.com/live/flight/${encodeURIComponent(a.callsign)}" target="_blank" rel="noopener">See route on FlightAware ›</a>` : '';
  const bad = !a._leg && (!r || !r.from || !r.to || routePlausible(r, a) === false);
  if (bad) {
    const inf = inferLeg(a, r);
    if (inf && inf.from && inf.to) return progressHTML({ ...a, _leg: inf });               // e.g. IAH → LAX
    if (inf) {
      const ap = inf.mode === 'from' ? inf.from : inf.to;
      const verb = inf.mode === 'from' ? 'Departed' : 'Arriving at';
      return `<div class="route"><div class="ends"><div class="ap"><b>${esc(ap.code)}</b><span>${verb} ${esc(ap.city || '')}</span></div></div>
        <div class="sub"><span class="phase ${phase(a)}">${PHASE_LABEL[phase(a)]}</span><span>${inf.mode === 'from' ? 'Destination not published' : 'Origin not published'}</span></div></div>${fa}`;
    }
  }
  if (r && r.from && r.to && routePlausible(r, a) === false) {
    return `<div class="noroute">Route uncertain: listed as ${esc(r.from.code)} → ${esc(r.to.code)}, which doesn't match where this flight is.</div>${fa}`;
  }
  if (!r || !r.from || !r.to) {
    const note = a.ground ? 'On the ground nearby' : isAirline(a) ? 'Route not published for this flight' : 'Private flight · no published route';
    return `<div class="noroute">${note}</div>${a.ground ? '' : fa}`;
  }
  let pct = null, flown = null, togo = null;
  if (r.from.lat != null && r.to.lat != null) {
    flown = distMi(r.from.lat, r.from.lon, a.lat, a.lon);
    togo = distMi(a.lat, a.lon, r.to.lat, r.to.lon);
    pct = Math.max(0, Math.min(100, (flown / (flown + togo)) * 100));
  }
  const ph = phase(a);
  const sub = pct != null
    ? `${Math.round(metric() ? flown * 1.609 : flown).toLocaleString()} ${metric() ? 'km' : 'mi'} flown · ${Math.round(metric() ? togo * 1.609 : togo).toLocaleString()} to go`
    : 'Progress unavailable';
  return `<div class="route">
    <div class="ends">
      <div class="ap"><b>${esc(r.from.code)}</b><span>${esc(r.from.city || r.from.name || '')}</span></div>
      <div class="ap r"><b>${esc(r.to.code)}</b><span>${esc(r.to.city || r.to.name || '')}</span></div>
    </div>
    <div class="bar ${ph}" role="img" aria-label="${pct != null ? Math.round(pct) + '% of the way from ' + esc(r.from.code) + ' to ' + esc(r.to.code) : 'Route ' + esc(r.from.code) + ' to ' + esc(r.to.code)}">
      <span class="track"></span>
      ${pct != null ? `<span class="fill" style="width:${pct.toFixed(1)}%"></span><span class="plane" style="left:${pct.toFixed(1)}%">${planeSVG(90)}</span>` : ''}
      <span class="pin l"></span><span class="pin r"></span>
    </div>
    <div class="sub"><span class="phase ${ph}">${PHASE_LABEL[ph]}</span><span>${sub}</span></div>
  </div>`;
}

function statHTML(label, value, sub) { return `<div class="stat"><dt>${label}</dt><dd>${value}</dd>${sub ? `<div class="ssub">${sub}</div>` : ''}</div>`; }
function altValue(a) {
  if (a.ground) return 'Ground';
  if (a.alt == null) return '—';
  return metric() ? `${Math.round(a.alt * 0.3048).toLocaleString()}<small> m</small>` : `${Math.round(a.alt).toLocaleString()}<small> ft</small>`;
}
function cardHTML(a) {
  const e = enrich.ac.get(a.hex) || {};
  const tail = a.reg || e.reg || '';
  const air = airlineName(a);
  const mph = a.gs != null ? Math.round(a.gs * 1.15078) : null;
  const vr = a.vrate != null && Math.abs(a.vrate) > 100 ? `${a.vrate > 0 ? '↑' : '↓'} ${fmtRate(Math.abs(a.vrate)).replace('+', '')}` : (a.ground ? '' : 'level');
  return `<article class="card" data-open="${a.hex}" tabindex="0" aria-label="${esc(flightLabel(a))}, tap for details">
    <header class="head">
      <div class="logo">${logoHTML(a)}</div>
      <div class="ident">
        <h2 class="fno">${esc(flightLabel(a))}</h2>
        ${air ? `<div class="airline">${esc(air)}</div>` : ''}
      </div>
      <div class="where"><b>${fmtDist(a.dist)}</b><span>${ARROW(a.brg)}${cardinal(a.brg)}</span></div>
    </header>
    <div class="acft"><span>${esc(typeName(a))}</span>${tail && tail.replace(/-/g,'') !== flightLabel(a).replace(/[ -]/g,'') ? `<span class="tail">${esc(tail)}</span>` : ''}</div>
    <dl class="stats">
      ${statHTML('Altitude', altValue(a), vr)}
      ${statHTML('Speed', a.gs != null ? (metric() ? `${Math.round(a.gs * 1.852)}<small> km/h</small>` : `${mph}<small> mph</small>`) : '—', a.gs != null && !metric() ? `${Math.round(a.gs)} kt` : '')}
      ${statHTML('Heading', a.track != null ? `${Math.round(a.track)}°` : '—', a.track != null ? cardinal(a.track) : '')}
    </dl>
    ${progressHTML(a)}
  </article>`;
}

function emptyHTML() {
  const t = new Date();
  let head = 'Clear skies overhead', body = `Nothing within ${fmtDist(cfg.radiusMi)} right now.`, actions = '';
  if (locError && !here) {
    head = 'Where are you?'; body = esc(locError);
    actions = `<button class="pill" data-act="retryLoc" type="button">Try location again</button><button class="pill" data-act="settings" type="button">Set a fixed point</button>`;
  } else if (!here) { head = 'Finding you…'; body = 'Waiting for your location.'; }
  else if (state.needsRelay) {
    head = 'Live data needs a relay';
    body = 'The free ADS-B networks don’t let web pages read them directly. Add your relay address in Settings; the steps are in the project README.';
    actions = `<button class="pill" data-act="settings" type="button">Open Settings</button><button class="pill" data-act="demo" type="button">Show demo</button>`;
  } else if (state.error) {
    head = 'Flight data is unavailable';
    body = cfg.source === 'local' ? `Your receiver didn’t answer (${esc(state.error)}).` : `The data feed didn’t answer (${esc(state.error)}). Retrying every ${cfg.refreshSec} s.`;
    actions = `<button class="pill" data-act="retry" type="button">Retry now</button>`;
  } else if (!state.updated) { head = 'Looking up…'; body = 'Checking the sky around you.'; }
  else if (state.last) body += ` Last seen: ${esc(state.last.name)} at ${new Date(state.last.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`;
  return `<article class="card empty">
    <div class="sweep" aria-hidden="true"><span></span><span></span><span></span></div>
    <div class="clock">${t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
    <h2>${head}</h2><p>${body}</p>${actions ? `<div class="acts">${actions}</div>` : ''}
  </article>`;
}

function tabsHTML() {
  if (state.list.length < 2) return '';
  return state.list.map(a => `<button class="tab${a.hex === state.selected ? ' on' : ''}" data-tab="${a.hex}" type="button" role="tab" aria-selected="${a.hex === state.selected}">${esc(flightLabel(a))}<span>${fmtDist(a.dist)}</span></button>`).join('');
}

/* drill-down sheet: photo, full route, everything else */
function photoBlock(a) {
  const p = enrich.photo.get(a.hex);
  if (p && (p.large || p.thumb)) {
    const who = p.by ? `© ${esc(p.by)}` : 'Photo';
    const credit = p.link ? `<a href="${esc(p.link)}" target="_blank" rel="noopener">${who}</a> · ${esc(p.site)}` : `${who} · ${esc(p.site)}`;
    return `<figure class="photo"><img src="${esc(p.large || p.thumb)}" alt="${esc(typeName(a))} ${esc(a.reg || '')}" onerror="this.parentNode.remove()"><figcaption>${credit}</figcaption></figure>`;
  }
  return '';
}
function detailHTML(a) {
  const r = routeOf(a), e = enrich.ac.get(a.hex) || {};
  const tail = a.reg || e.reg || '';
  const f = (k, v) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
  return `<div class="grab"></div>
    <div class="dtop"><div><h2>${esc(flightLabel(a))}</h2><p>${esc([airlineName(a), typeName(a)].filter(Boolean).join(' · '))}</p></div>
      <button class="close" data-act="close" aria-label="Close" type="button">✕</button></div>
    ${photoBlock(a)}
    ${r && r.from && routePlausible(r, a) !== false ? `<div class="droute"><div><b>${esc(r.from.code)}</b><span>${esc(r.from.name || r.from.city || '')}</span></div><div class="r"><b>${esc(r.to.code)}</b><span>${esc(r.to.name || r.to.city || '')}</span></div></div>` : ''}
    <dl class="facts">
      ${f('Altitude', fmtAlt(a))}${f('Vertical rate', fmtRate(a.vrate))}${f('Ground speed', fmtSpd(a.gs))}
      ${f('Heading', a.track != null ? Math.round(a.track) + '°' : '—')}${f('From you', `${fmtDist(a.dist)} ${cardinal(a.brg)}`)}${f('Squawk', esc(a.squawk || '—'))}
      ${f('Registration', esc(tail || '—'))}${f('Type code', esc(a.type || e.icaoType || '—'))}${f('Callsign', esc(a.callsign || '—'))}
      ${f('Operator', esc(airlineName(a) || '—'))}${f('Mode S hex', esc(a.hex.toUpperCase()))}${f('Data', esc(state.label || '—'))}
    </dl>
    <div class="links">
      <a href="https://globe.airplanes.live/?icao=${a.hex}" target="_blank" rel="noopener">Live map</a>
      ${a.callsign ? `<a href="https://www.flightaware.com/live/flight/${encodeURIComponent(a.callsign)}" target="_blank" rel="noopener">FlightAware</a>` : ''}
      ${tail ? `<a href="https://www.planespotters.net/search?q=${encodeURIComponent(tail)}" target="_blank" rel="noopener">Photos</a>` : ''}
    </div>
    ${r && r.via !== 'demo' ? `<p class="fine">${routePlausible(r, a) === false ? `Listed route ${esc(r.from.code)} → ${esc(r.to.code)} doesn't match this flight's position, so it isn't shown. ` : ''}Routes come from a callsign database (${esc(r.via)}) and are occasionally out of date.</p>` : ''}`;
}

/* ---------- render ---------- */
let rq;
// A plain timer, not requestAnimationFrame: animation frames pause while the page isn't on screen,
// which left cards without routes after lookups finished in the background.
function scheduleRender() { if (!rq) rq = setTimeout(() => { rq = null; render(); }, 60); }
function render() {
  document.body.classList.toggle('kiosk', !!cfg.kiosk);
  document.documentElement.classList.toggle('kiosk', !!cfg.kiosk);
  document.body.dataset.sky = skyPhase();
  paintSky();
  if (!state.list.some(a => a.hex === state.selected)) state.selected = state.list[0]?.hex || null;
  const a = state.list.find(x => x.hex === state.selected);
  // Phone: every aircraft in range as a stack of cards, nearest first.
  // Patio display: one big card at a time, cycling, with the faint tabs above.
  $('tabs').innerHTML = cfg.kiosk ? tabsHTML() : '';
  $('tabs').hidden = !cfg.kiosk || state.list.length < 2;
  $('tabs').querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  $('stage').innerHTML = !state.list.length ? emptyHTML() : cfg.kiosk ? cardHTML(a) : state.list.map(cardHTML).join('');
  $('where').textContent = here ? `Within ${fmtDist(cfg.radiusMi).replace('.0 ', ' ')} of ${here.fixed ? 'your spot' : 'you'}` : 'Overhead';
  statusLine();
  if (sheetOpen) { const d = state.list.find(x => x.hex === sheetOpen); if (d) $('sheetInner').innerHTML = detailHTML(d); }
}
function statusLine() {
  const el = $('status'); let txt = '', cls = '';
  if (state.error || state.needsRelay) { cls = 'err'; txt = state.needsRelay ? 'Relay not set' : `${state.errorSource || 'Data'}: ${state.error}`; }
  else if (state.updated) {
    const age = Math.round((Date.now() - state.updated) / 1000);
    if (age > cfg.refreshSec * 3) cls = 'stale';
    txt = `${state.label} · ${age < 2 ? 'just now' : age + 's ago'}${state.list.length > 1 ? ` · ${state.list.length} aircraft` : ''}`;
  }
  el.className = 'status ' + cls; el.innerHTML = txt ? `<span class="dot"></span>${esc(txt)}` : '';
}

/* ---------- interaction (read-only: pick a tab, open details) ---------- */
let sheetOpen = null;
function openDetail(hex) {
  const a = state.list.find(x => x.hex === hex); if (!a) return;
  sheetOpen = hex;
  if (!cfg.demo) want('photo', a.hex, () => lookupPhoto({ ...a, reg: a.reg || enrich.ac.get(a.hex)?.reg }));
  $('sheetInner').innerHTML = detailHTML(a);
  $('sheet').classList.add('open'); $('scrim').classList.add('open'); $('sheet').setAttribute('aria-hidden', 'false');
}
function closeDetail() {
  sheetOpen = null;
  $('sheet').classList.remove('open'); $('scrim').classList.remove('open'); $('sheet').setAttribute('aria-hidden', 'true');
}
document.addEventListener('click', ev => {
  if (ev.target.closest('a[href]')) return;                     // links (e.g. FlightAware) just open
  const tab = ev.target.closest('[data-tab]');
  if (tab) { state.selected = tab.dataset.tab; userPicked = Date.now(); render(); return; }
  const act = ev.target.closest('[data-act]')?.dataset.act;
  if (act === 'close') return closeDetail();
  if (act === 'settings') return openSettings();
  if (act === 'retry') return poll(true);
  if (act === 'retryLoc') { startLocation(); render(); return; }
  if (act === 'demo') { cfg.demo = true; poll(true); return; } // demo from a button lasts until the app is reopened
  const card = ev.target.closest('[data-open]');
  if (card && !cfg.kiosk) openDetail(card.dataset.open);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && sheetOpen) closeDetail();
  if (e.key === 'Enter' && document.activeElement?.dataset?.open) openDetail(document.activeElement.dataset.open);
});
$('scrim').addEventListener('click', closeDetail);

/* settings dialog */
const dlg = $('settings');
function syncSettingsVis() {
  $('f-local').hidden = $('s-source').value !== 'local';
  $('f-relay').hidden = $('s-source').value === 'local';
  $('f-fixedwrap').hidden = $('s-loc').value !== 'fixed';
  $('s-radiusVal').textContent = `${$('s-radius').value} mi`;
  $('s-refreshVal').textContent = `${$('s-refresh').value} s`;
}
function openSettings() {
  $('s-source').value = cfg.source; $('s-localUrl').value = cfg.localUrl; $('s-relay').value = cfg.relay === DEFAULT_RELAY ? '' : (cfg.relay || '');
  $('s-radius').value = cfg.radiusMi; $('s-refresh').value = cfg.refreshSec;
  $('s-loc').value = cfg.locMode; $('s-lat').value = cfg.lat ?? ''; $('s-lon').value = cfg.lon ?? '';
  $('s-units').value = cfg.units; $('s-ground').checked = cfg.showGround; $('s-kiosk').checked = cfg.kiosk; $('s-demo').checked = cfg.demo;
  // Open Advanced when something in it is switched on, so it's never hidden from view.
  dlg.querySelector('.adv').open = !!(cfg.demo || cfg.kiosk || cfg.source !== 'auto' || (cfg.relay && cfg.relay !== DEFAULT_RELAY));
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
  cfg.source = $('s-source').value; cfg.localUrl = $('s-localUrl').value.trim() || DEFAULTS.localUrl; cfg.relay = $('s-relay').value.trim() || DEFAULT_RELAY;
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

/* kiosk: cycle through aircraft unless someone just picked one; keep the screen on */
let userPicked = 0;
setInterval(() => {
  if (!cfg.kiosk || state.list.length < 2 || Date.now() - userPicked < 30000) return;
  const i = state.list.findIndex(a => a.hex === state.selected);
  state.selected = state.list[(i + 1) % state.list.length].hex; render();
}, 10000);
setInterval(() => { statusLine(); if (!state.list.length) render(); }, 1000);
let lock;
async function wake() { try { if ('wakeLock' in navigator && cfg.kiosk) lock = await navigator.wakeLock.request('screen'); } catch { /* not granted */ } }
document.addEventListener('visibilitychange', () => { if (!document.hidden && cfg.kiosk) wake(); });

// Read-only snapshot for troubleshooting from the browser console: overheadDebug()
window.overheadDebug = () => ({ list: state.list.map(a => ({ cs: a.callsign, hex: a.hex, route: routeOf(a) && routeOf(a).from ? routeOf(a).from.code + '-' + routeOf(a).to.code : routeOf(a) === null ? null : 'none' })), routesKnown: [...enrich.route.keys()], pending: [...enrich.pending], queue: enrich.queue.length });

// Small read-only bridge for the sky view (ar.js).
window.Overhead = {
  get here() { return here; }, get list() { return state.list; }, get all() { return state.all || state.list; },
  get updated() { return state.updated; }, get metric() { return metric(); }, get kiosk() { return !!cfg.kiosk; },
  distMi, bearing, sunPos, moonPos, skyPhase, flightLabel, typeName, openDetail, routeOf,
};

/* ---------- boot ---------- */
if ('serviceWorker' in navigator && window.isSecureContext && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
startLocation();
if (cfg.kiosk) wake();
render();
poll(true);
})();
