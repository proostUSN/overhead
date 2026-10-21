/* Overhead sky view: point the phone at the sky and see each aircraft where it really is.
   Uses the camera, the compass/tilt sensors, and the same live data as the cards.
   World frame: x = east, y = north, z = up. */
(() => {
'use strict';
const O = window.Overhead;
const $ = id => document.getElementById(id);
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
const norm360 = d => ((d % 360) + 360) % 360;
const wrap180 = d => ((d + 540) % 360) - 180;

/* ---------- vector helpers ---------- */
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const unit = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const fromAzEl = (az, el) => [Math.sin(rad(az)) * Math.cos(rad(el)), Math.cos(rad(az)) * Math.cos(rad(el)), Math.sin(rad(el))];
const yaw = (v, th) => { const c = Math.cos(rad(th)), s = Math.sin(rad(th)); return [v[0] * c + v[1] * s, -v[0] * s + v[1] * c, v[2]]; };

// W3C device orientation → device axes in the world frame (R = Rz(α)·Rx(β)·Ry(γ); columns are X, Y, Z).
function deviceAxes(alpha, beta, gamma) {
  const cA = Math.cos(rad(alpha)), sA = Math.sin(rad(alpha));
  const cB = Math.cos(rad(beta)), sB = Math.sin(rad(beta));
  const cG = Math.cos(rad(gamma)), sG = Math.sin(rad(gamma));
  return {
    X: [cA * cG - sA * sB * sG, cG * sA + cA * sB * sG, -cB * sG],
    Y: [-cB * sA, cA * cB, sB],
    Z: [cG * sA * sB + cA * sG, sA * sG - cA * cG * sB, cB * cG],
  };
}
// Camera looks out the back (−Z). Screen axes follow the current screen rotation.
function cameraBasis(alpha, beta, gamma, screenAngle) {
  const { X, Y, Z } = deviceAxes(alpha, beta, gamma);
  const c = Math.cos(rad(screenAngle)), s = Math.sin(rad(screenAngle));
  return { f: scale(Z, -1), r: add(scale(X, c), scale(Y, -s)), u: add(scale(Y, c), scale(X, s)) };
}

/* ---------- orientation tracking ---------- */
const view = { basis: null, raw: null, offset: null, nudge: 0, absolute: false, accuracy: null, lastEvent: 0 };
function screenAngle() {
  const a = (screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle : (window.orientation || 0);
  return norm360(a);
}
function onOrientation(e) {
  if (e.alpha == null || e.beta == null || e.gamma == null) return;
  const b = cameraBasis(e.alpha, e.beta, e.gamma, screenAngle());
  if (e.webkitCompassHeading != null && e.webkitCompassHeading >= 0) {
    // iPhone: alpha is relative to an arbitrary start. Tie it to the compass while the camera is within ~45°
    // of the horizon (where iOS reports the heading of the back camera); keep that offset when looking up.
    view.absolute = false;
    view.accuracy = e.webkitCompassAccuracy;
    const horiz = Math.hypot(b.f[0], b.f[1]);
    if (horiz > 0.7 || view.offset == null) {
      const camAz = deg(Math.atan2(b.f[0], b.f[1]));
      const target = wrap180(e.webkitCompassHeading - camAz);
      view.offset = view.offset == null ? target : view.offset + wrap180(target - view.offset) * 0.08;
    }
  } else if (e.absolute || e.type === 'deviceorientationabsolute') {
    view.absolute = true; view.offset = 0;
  } else if (!view.absolute) {
    view.offset = view.offset ?? 0;                                   // no compass available: relative only
  }
  view.raw = b; view.lastEvent = performance.now();
}
function currentBasis() {
  if (!view.raw) return null;
  const th = (view.offset || 0) + view.nudge;
  const t = { f: yaw(view.raw.f, th), r: yaw(view.raw.r, th), u: yaw(view.raw.u, th) };
  if (!view.basis) { view.basis = t; return t; }
  // Smooth sensor jitter, then keep the axes square.
  const k = 0.35, B = view.basis;
  let f = unit(add(scale(B.f, 1 - k), scale(t.f, k)));
  let u = add(scale(B.u, 1 - k), scale(t.u, k));
  u = unit(add(u, scale(f, -dot(u, f))));
  const r = cross(f, u);
  view.basis = { f, r, u };
  return view.basis;
}

/* ---------- projection ---------- */
const LONG_FOV = 62;                                    // phone main camera, along the screen's long side
let W = 0, H = 0, DPR = 1, FPX = 1;
function project(v, B) {
  const z = dot(v, B.f), x = dot(v, B.r), y = dot(v, B.u);
  return { x: W / 2 + (x / z) * FPX, y: H / 2 - (y / z) * FPX, z, cx: x, cy: y };
}
const onScreen = (p, m = 0) => p.z > 0.02 && p.x > -m && p.x < W + m && p.y > -m && p.y < H + m;

/* ---------- aircraft geometry ---------- */
const R_EARTH = 6371000, M_PER_DEG = 111320;
function extrapolate(a, now) {
  const age = Math.min(60, Math.max(0, (now - (O.updated || now)) / 1000 + (a.seenPos || 0)));
  let { lat, lon } = a, alt = a.alt;
  if (a.gs != null && a.track != null) {
    const d = a.gs * 0.514444 * age;
    lat += (d * Math.cos(rad(a.track))) / M_PER_DEG;
    lon += (d * Math.sin(rad(a.track))) / (M_PER_DEG * Math.cos(rad(lat)));
  }
  if (alt != null && a.vrate != null) alt += a.vrate * age / 60;
  return { lat, lon, alt };
}
function skyPoint(here, p) {
  const dM = O.distMi(here.lat, here.lon, p.lat, p.lon) * 1609.344;
  const az = O.bearing(here.lat, here.lon, p.lat, p.lon);
  const hM = (p.alt ?? 0) * 0.3048 - (here.altM || 0) - (dM * dM) / (2 * R_EARTH);
  const el = deg(Math.atan2(hM, Math.max(dM, 1)));
  const range = Math.hypot(dM, hM);
  return { az, el, dM, range };
}
// How the aircraft is moving relative to you: toward, away, or crossing left/right.
function aspect(sp, a) {
  if (a.track == null) return '';
  const rel = wrap180(a.track - sp.az);
  if (Math.abs(rel) > 140) return 'coming toward you';
  if (Math.abs(rel) < 40) return 'moving away';
  return rel > 0 ? 'crossing to the right' : 'crossing to the left';
}

/* ---------- fixed sky decorations ---------- */
const STARS = (() => { let s = 11; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: 260 }, () => ({ az: rnd() * 360, el: deg(Math.asin(rnd())) , m: rnd() })); })();
const PLANE = new Path2D('M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z');
const CARD = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/* ---------- rendering ---------- */
let canvas, ctx, video, raf = 0, running = false, cameraOn = false, markers = [], hintSince = 0;
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = canvas.clientWidth; H = canvas.clientHeight;
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  FPX = (Math.max(W, H) / 2) / Math.tan(rad(LONG_FOV / 2));
}
function theme() {
  const ph = O.skyPhase();
  return ph === 'day'
    ? { phase: ph, ink: '#0f1d33', pill: 'rgba(255,255,255,.88)', pillInk: '#0f1d33', line: 'rgba(255,255,255,.75)', soft: 'rgba(255,255,255,.45)', plane: '#ffffff', planeEdge: 'rgba(15,29,51,.85)', glow: 'rgba(0,0,0,0)' }
    : ph === 'dusk'
    ? { phase: ph, ink: '#fff', pill: 'rgba(20,22,48,.78)', pillInk: '#fff', line: 'rgba(255,230,210,.7)', soft: 'rgba(255,220,200,.4)', plane: '#fff4e0', planeEdge: 'rgba(20,22,48,.9)', glow: 'rgba(255,200,140,.55)' }
    : { phase: ph, ink: '#fff', pill: 'rgba(8,14,34,.78)', pillInk: '#fff', line: 'rgba(160,190,255,.55)', soft: 'rgba(160,190,255,.3)', plane: '#ffffff', planeEdge: 'rgba(5,10,25,.9)', glow: 'rgba(140,190,255,.7)' };
}
function drawBackdrop(B, T) {
  if (cameraOn) {
    // A light wash keeps markers readable over a bright sky or a dark one.
    ctx.fillStyle = T.phase === 'day' ? 'rgba(10,30,70,.10)' : 'rgba(0,0,10,.18)';
    ctx.fillRect(0, 0, W, H);
    return;
  }
  // No camera: paint the sky for the time of day, darker toward the zenith.
  const look = deg(Math.asin(Math.max(-1, Math.min(1, B.f[2]))));
  const g = ctx.createLinearGradient(0, 0, 0, H);
  const pal = T.phase === 'day' ? ['#2a64bd', '#5b9be0', '#a9d4f5'] : T.phase === 'dusk' ? ['#2b3a78', '#8a5a96', '#f2a76f'] : ['#04081a', '#0d1a3c', '#1d3266'];
  const lift = Math.max(0, Math.min(1, look / 70));
  g.addColorStop(0, pal[0]); g.addColorStop(0.6 - lift * 0.4, pal[1]); g.addColorStop(1, lift > 0.6 ? pal[1] : pal[2]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  if (T.phase !== 'day') {
    const fade = T.phase === 'dusk' ? 0.35 : 1;
    for (const s of STARS) {
      const p = project(fromAzEl(s.az, s.el), B);
      if (!onScreen(p)) continue;
      ctx.globalAlpha = fade * (0.35 + s.m * 0.65);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(p.x, p.y, s.m > 0.9 ? 1.6 : 1, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
function drawGrid(B, T) {
  // Horizon line with compass points, and faint rings at 30° and 60° up.
  ctx.lineWidth = 1.5; ctx.strokeStyle = T.line;
  for (const [el, dash, w] of [[0, [], 1.5], [30, [3, 7], 1], [60, [3, 7], 1]]) {
    ctx.setLineDash(dash); ctx.lineWidth = w; ctx.strokeStyle = el ? T.soft : T.line;
    ctx.beginPath(); let pen = false;
    for (let az = 0; az <= 360; az += 3) {
      const p = project(fromAzEl(az, el), B);
      if (p.z <= 0.05) { pen = false; continue; }
      pen ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); pen = true;
    }
    ctx.stroke();
    if (el) {
      const p = project(fromAzEl(deg(Math.atan2(B.f[0], B.f[1])) + 8, el), B);
      if (onScreen(p)) { ctx.font = '600 11px -apple-system,system-ui,sans-serif'; ctx.fillStyle = T.soft; ctx.fillText(`${el}°`, p.x + 4, p.y - 4); }
    }
  }
  ctx.setLineDash([]);
  ctx.font = '700 13px -apple-system,system-ui,sans-serif'; ctx.textAlign = 'center';
  for (let i = 0; i < 8; i++) {
    const p = project(fromAzEl(i * 45, 0), B);
    if (!onScreen(p)) continue;
    ctx.fillStyle = T.line; ctx.fillText(CARD[i], p.x, p.y - 8);
    ctx.beginPath(); ctx.moveTo(p.x, p.y - 4); ctx.lineTo(p.x, p.y + 4); ctx.stroke();
  }
  ctx.textAlign = 'left';
}
function drawSunMoon(B, T, here) {
  const now = new Date();
  const sun = O.sunPos(here.lat, here.lon, now), moon = O.moonPos(here.lat, here.lon, now);
  const sp = project(fromAzEl(sun.az, sun.alt), B);
  if (sun.alt > -2 && onScreen(sp, 60)) {
    const rS = 26, g = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, rS * 4);
    g.addColorStop(0, 'rgba(255,250,225,.95)'); g.addColorStop(0.25, 'rgba(255,230,160,.55)'); g.addColorStop(1, 'rgba(255,210,120,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sp.x, sp.y, rS * 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fffbe8'; ctx.beginPath(); ctx.arc(sp.x, sp.y, rS * 0.6, 0, Math.PI * 2); ctx.fill();
    if (onScreen(sp, -20)) label(sp.x, sp.y + rS + 14, 'Sun · don’t look directly', T, true);
  }
  const mp = project(fromAzEl(moon.az, moon.alt), B);
  if (moon.alt > -1 && onScreen(mp, 40)) {
    const r = 16;
    ctx.save();
    ctx.shadowColor = 'rgba(220,230,255,.6)'; ctx.shadowBlur = T.phase === 'day' ? 6 : 24;
    ctx.fillStyle = '#f4f2e8'; ctx.beginPath(); ctx.arc(mp.x, mp.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // Phase: darken the unlit part with an offset disc (waxing lit on the right in the northern hemisphere).
    ctx.save(); ctx.beginPath(); ctx.arc(mp.x, mp.y, r, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = T.phase === 'day' ? 'rgba(70,120,200,.85)' : 'rgba(10,16,40,.92)';
    const off = (moon.waxing ? -1 : 1) * moon.lit * 2 * r;
    ctx.beginPath(); ctx.arc(mp.x + off, mp.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (onScreen(mp, -20)) label(mp.x, mp.y + r + 14, `Moon · ${Math.round(moon.lit * 100)}% lit`, T, true);
  }
}
function label(x, y, text, T, small) {
  ctx.font = `${small ? 600 : 700} ${small ? 11 : 13}px -apple-system,system-ui,sans-serif`;
  const w = ctx.measureText(text).width + 14, h = small ? 18 : 22;
  ctx.fillStyle = T.pill; roundRect(x - w / 2, y - h / 2, w, h, h / 2); ctx.fill();
  ctx.fillStyle = T.pillInk; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + 0.5);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

function fmtAltShort(ft) { return O.metric ? `${Math.round(ft * 0.3048).toLocaleString()} m` : ft >= 18000 ? `FL${Math.round(ft / 100)}` : `${Math.round(ft / 100) * 100 >= 1000 ? (Math.round(ft / 100) * 100).toLocaleString() : Math.round(ft)} ft`; }
function fmtRange(m) { return O.metric ? `${(m / 1000).toFixed(1)} km` : `${(m / 1609.344).toFixed(1)} mi`; }

function drawAircraft(B, T, here, now) {
  markers = [];
  const list = O.all.filter(a => a.lat != null && a.alt != null);
  const items = list.map(a => {
    const p = extrapolate(a, now), sp = skyPoint(here, p);
    return { a, p, sp, v: fromAzEl(sp.az, sp.el) };
  }).sort((x, y) => y.sp.range - x.sp.range);           // far first, near on top
  const edge = [];
  for (const it of items) {
    const s = project(it.v, B);
    if (!onScreen(s, 10)) { edge.push({ it, s }); continue; }
    // Screen direction of travel: project a point 1 km ahead along the track (and climb).
    let ang = -Math.PI / 2, fore = 1;
    if (it.a.track != null) {
      const ahead = { lat: it.p.lat + 1000 * Math.cos(rad(it.a.track)) / M_PER_DEG, lon: it.p.lon + 1000 * Math.sin(rad(it.a.track)) / (M_PER_DEG * Math.cos(rad(it.p.lat))), alt: it.p.alt + (it.a.vrate || 0) * (1000 / Math.max(50, (it.a.gs || 200) * 0.514444)) / 60 };
      const sa = skyPoint(here, ahead), s2 = project(fromAzEl(sa.az, sa.el), B);
      if (s2.z > 0) {
        const dx = s2.x - s.x, dy = s2.y - s.y, len = Math.hypot(dx, dy);
        ang = Math.atan2(dy, dx);
        fore = Math.max(0.28, Math.min(1, len / ((1000 / it.sp.range) * FPX)));   // short = moving toward/away from you
      }
    }
    const size = Math.max(22, Math.min(54, 2600 / Math.sqrt(it.sp.range)));
    ctx.save();
    ctx.translate(s.x, s.y); ctx.rotate(ang + Math.PI / 2); ctx.scale(size / 24, (size / 24) * fore); ctx.translate(-12, -12);
    if (T.glow !== 'rgba(0,0,0,0)') { ctx.shadowColor = T.glow; ctx.shadowBlur = 14; }
    ctx.fillStyle = T.plane; ctx.fill(PLANE);
    ctx.shadowBlur = 0; ctx.lineWidth = 1.4 * 24 / size; ctx.strokeStyle = T.planeEdge; ctx.stroke(PLANE);
    if (T.phase !== 'day') {                                    // nav lights: red left wing, green right
      ctx.fillStyle = '#ff4d4d'; ctx.beginPath(); ctx.arc(2.6, 15, 1.1, 0, 7); ctx.fill();
      ctx.fillStyle = '#3dff8b'; ctx.beginPath(); ctx.arc(21.4, 15, 1.1, 0, 7); ctx.fill();
    }
    ctx.restore();
    // Label below the aircraft.
    const name = O.flightLabel(it.a);
    const line2 = `${fmtAltShort(it.p.alt)} · ${fmtRange(it.sp.range)} · ${Math.round(it.sp.el)}° up`;
    const asp = aspect(it.sp, it.a);
    ctx.font = '700 14px -apple-system,system-ui,sans-serif';
    const w1 = ctx.measureText(name).width;
    ctx.font = '500 11.5px -apple-system,system-ui,sans-serif';
    const w2 = Math.max(ctx.measureText(line2).width, asp ? ctx.measureText(asp).width : 0);
    const bw = Math.max(w1, w2) + 18, bh = asp ? 54 : 40;
    const bx = Math.max(8, Math.min(W - bw - 8, s.x - bw / 2));
    let by = s.y + size * 0.6 + 6;
    if (by + bh > H - 70) by = s.y - size * 0.6 - 6 - bh;           // near the bottom: put the label above
    const tx = bx + bw / 2;
    ctx.fillStyle = T.pill; roundRect(bx, by, bw, bh, 11); ctx.fill();
    ctx.fillStyle = T.pillInk; ctx.textAlign = 'center';
    ctx.font = '700 14px -apple-system,system-ui,sans-serif'; ctx.fillText(name, tx, by + 17);
    ctx.font = '500 11.5px -apple-system,system-ui,sans-serif'; ctx.globalAlpha = 0.85; ctx.fillText(line2, tx, by + 32);
    if (asp) ctx.fillText(asp, tx, by + 46);
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
    markers.push({ hex: it.a.hex, x: s.x, y: s.y, r: size * 0.8, box: [bx, by, bw, bh] });
  }
  // Off-screen aircraft: arrows on the edge pointing the way to turn.
  edge.sort((x, y) => x.it.sp.range - y.it.sp.range);
  const placed = [];
  for (const { it, s } of edge.slice(0, 6)) {
    let dx = s.cx, dy = -s.cy;
    if (s.z <= 0.02 && Math.hypot(dx, dy) < 0.05) dy = 1;      // directly behind: suggest turning around
    const ang = Math.atan2(dy, dx), m = 34, top = 96, bottom = H - 96, cy0 = (top + bottom) / 2;
    const kx = (W / 2 - m) / Math.abs(Math.cos(ang) || 1e-6), ky = ((bottom - top) / 2) / Math.abs(Math.sin(ang) || 1e-6);
    const k = Math.min(kx, ky), ex = W / 2 + Math.cos(ang) * k;
    let ey = cy0 + Math.sin(ang) * k;
    for (const q of placed) if (Math.abs(q.x - ex) < 90 && Math.abs(q.y - ey) < 46) ey += ey > cy0 ? -48 : 48;
    placed.push({ x: ex, y: ey });
    ctx.save(); ctx.translate(ex, ey); ctx.rotate(ang);
    ctx.fillStyle = T.pill; ctx.beginPath(); ctx.arc(0, 0, 17, 0, 7); ctx.fill();
    ctx.fillStyle = T.pillInk; ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-4, -7); ctx.lineTo(-4, 7); ctx.closePath(); ctx.fill();
    ctx.restore();
    const txt = `${O.flightLabel(it.a)} · ${fmtRange(it.sp.range)}`;
    const lx = Math.max(60, Math.min(W - 60, ex - Math.cos(ang) * 4)), ly = ey + (ey > H / 2 ? -28 : 30);
    label(lx, ly, txt, T, true);
  }
}
function drawStatus(B) {
  const az = norm360(deg(Math.atan2(B.f[0], B.f[1]))), el = deg(Math.asin(Math.max(-1, Math.min(1, B.f[2]))));
  $('ar-facing').textContent = `Facing ${CARD[Math.round(az / 45) % 8]} ${Math.round(az)}° · ${el >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(el))}°`;
  const n = O.all.length;
  $('ar-count').textContent = n ? `${n} aircraft nearby` : 'No aircraft nearby right now';
  const poor = view.accuracy != null && (view.accuracy < 0 || view.accuracy > 25);
  const hint = $('ar-hint');
  if (hint.dataset.locked) return;
  const msg = poor ? 'Compass needs calibrating: wave the phone in a figure 8.'
    : view.nudge ? `Aligned ${view.nudge > 0 ? '+' : ''}${Math.round(view.nudge)}° · double-tap to reset`
    : 'Drag sideways to line a marker up with the real plane.';
  hint.textContent = msg;
  hint.hidden = !poor && performance.now() - hintSince > 6000;
}
function frame() {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  const here = O.here, T = theme();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const B = currentBasis();
  if (!B || !here) {
    ctx.fillStyle = cameraOn ? 'rgba(0,0,0,.35)' : '#0d1a3c'; ctx.fillRect(0, 0, W, H);
    $('ar-facing').textContent = !here ? 'Waiting for your location…' : 'Waiting for the compass…';
    return;
  }
  drawBackdrop(B, T);
  drawGrid(B, T);
  drawSunMoon(B, T, here);
  drawAircraft(B, T, here, Date.now());
  drawStatus(B);
}

/* ---------- open / close ---------- */
async function open() {
  const sheet = $('ar'); sheet.hidden = false; document.body.classList.add('ar-open');
  canvas = $('ar-canvas'); ctx = canvas.getContext('2d'); video = $('ar-video');
  resize();
  // Both permissions must be asked from this tap.
  const motion = (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function')
    ? DeviceOrientationEvent.requestPermission().catch(() => 'denied') : Promise.resolve('granted');
  const cam = navigator.mediaDevices?.getUserMedia
    ? navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }).catch(() => null) : Promise.resolve(null);
  const [m, stream] = await Promise.all([motion, cam]);
  hintSince = performance.now(); $('ar-hint').hidden = false; delete $('ar-hint').dataset.locked;
  if (m !== 'granted') { $('ar-hint').textContent = 'Motion access was declined. Close the app fully, reopen it and tap Sky again, then choose Allow.'; $('ar-hint').dataset.locked = '1'; }
  window.addEventListener('deviceorientationabsolute', onOrientation, true);
  window.addEventListener('deviceorientation', onOrientation, true);
  if (stream) { video.srcObject = stream; video.hidden = false; cameraOn = true; try { await video.play(); } catch { /* shown when ready */ } }
  else { video.hidden = true; cameraOn = false; }
  running = true; frame();
  try { await navigator.wakeLock?.request('screen'); } catch { /* optional */ }
}
function close() {
  running = false; cancelAnimationFrame(raf);
  window.removeEventListener('deviceorientationabsolute', onOrientation, true);
  window.removeEventListener('deviceorientation', onOrientation, true);
  if (video?.srcObject) { video.srcObject.getTracks().forEach(t => t.stop()); video.srcObject = null; }
  cameraOn = false; view.basis = null;
  $('ar').hidden = true; document.body.classList.remove('ar-open');
}

/* ---------- touch: tap a marker for details, drag sideways to align ---------- */
let drag = null;
function pointerDown(e) { drag = { x: e.clientX, y: e.clientY, start: view.nudge, moved: false }; }
function pointerMove(e) {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  if (Math.abs(dx) > 8) drag.moved = true;
  if (drag.moved) view.nudge = drag.start - deg(Math.atan(dx / FPX));
}
let lastTap = 0;
function pointerUp(e) {
  if (!drag) return;
  const moved = drag.moved; drag = null;
  if (moved) { hintSince = performance.now(); return; }
  const t = performance.now();
  if (t - lastTap < 300) { view.nudge = 0; lastTap = 0; hintSince = performance.now(); return; }
  lastTap = t;
  const rect = canvas.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
  const hit = [...markers].reverse().find(m => Math.hypot(m.x - x, m.y - y) < Math.max(26, m.r) ||
    (x >= m.box[0] && x <= m.box[0] + m.box[2] && y >= m.box[1] && y <= m.box[1] + m.box[3]));
  if (hit) O.openDetail(hit.hex);
}

document.addEventListener('DOMContentLoaded', init);
if (document.readyState !== 'loading') init();
let inited = false;
function init() {
  if (inited) return; inited = true;
  $('skyBtn')?.addEventListener('click', open);
  $('ar-close')?.addEventListener('click', close);
  const c = $('ar-canvas');
  c.addEventListener('pointerdown', pointerDown);
  c.addEventListener('pointermove', pointerMove);
  c.addEventListener('pointerup', pointerUp);
  c.addEventListener('pointercancel', () => { drag = null; });
  window.addEventListener('resize', () => { if (running) resize(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && running) close(); });
  if (location.hash === '#sky') open();
}

// Exposed for testing the math without sensors.
window.OverheadAR = { deviceAxes, cameraBasis, fromAzEl, project: (v, B, w, h) => { W = w; H = h; FPX = (Math.max(w, h) / 2) / Math.tan(rad(LONG_FOV / 2)); return project(v, B); }, aspect, skyPoint };
})();
