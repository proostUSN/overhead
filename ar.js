/* Spot-Air sky view: point the phone at the sky and see each aircraft where it really is.
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
const SKY_RANGE_MI = 10;                              // the sky view shows aircraft out to 10 miles
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
// Closing, at its closest, or moving away: time until the closest point of approach (3D, straight-line).
function closure(here, p, a) {
  if (a.gs == null || a.track == null) return 'near';
  const pE = (p.lon - here.lon) * M_PER_DEG * Math.cos(rad(here.lat)), pN = (p.lat - here.lat) * M_PER_DEG;
  const pU = (p.alt ?? 0) * 0.3048 - (here.altM || 0);
  const g = a.gs * 0.514444, vE = g * Math.sin(rad(a.track)), vN = g * Math.cos(rad(a.track)), vU = (a.vrate || 0) * 0.00508;
  const v2 = vE * vE + vN * vN + vU * vU;
  if (v2 < 4) return 'near';                                     // hovering or very slow
  const t = -(pE * vE + pN * vN + pU * vU) / v2;                  // seconds until closest
  // "At its closest" while the current distance is within ~8% of the closest it will get.
  const r = Math.hypot(pE, pN, pU), c = Math.hypot(pE + vE * t, pN + vN * t, pU + vU * t);
  if (r - c < 0.08 * r) return 'near';
  return t > 0 ? 'closing' : 'away';
}
const HALO = { closing: '61,220,132', near: '255,176,32', away: '255,90,79' };
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
/* ---------- aircraft silhouettes (top view, nose up, 24-unit box) ---------- */
// Proportions per class: fuselage width/ends, wing (y of root leading edge, root chord, half-span,
// sweep, tip chord), tailplane, and engines. Built once into Path2D shapes.
const CLASSES = {
  quad:      { scale: 1.25, fw: 3.0, y0: 0.4, y1: 23.6, wing: [9, 5.8, 11.8, 5.6, 1.4], stab: [19.6, 2.6, 4.8, 2.2, 0.9], eng: [[4.4, 10.6, 1.5, 3], [8.1, 12.8, 1.4, 2.7]], tip: 'swept' },
  heavy:     { scale: 1.18, fw: 3.0, y0: 0.4, y1: 23.6, wing: [9, 5.6, 11.8, 5.4, 1.4], stab: [19.6, 2.6, 4.8, 2.2, 0.9], eng: [[5.2, 10.8, 1.8, 3.4]] },
  narrow:    { scale: 1.0,  fw: 2.4, y0: 1.0, y1: 23.0, wing: [9.6, 4.6, 10.6, 4.2, 1.2], stab: [19.6, 2.2, 4.2, 1.8, 0.8], eng: [[4.0, 10.9, 1.5, 2.7]] },
  rearjet:   { scale: 0.95, fw: 2.2, y0: 1.2, y1: 22.8, wing: [10.0, 3.8, 8.8, 2.8, 1.1], stab: [21.0, 1.8, 4.2, 1.4, 0.8], rear: [2.2, 15.8, 1.5, 3.4] },
  bizjet:    { scale: 0.85, fw: 2.0, y0: 1.6, y1: 22.6, wing: [10.4, 3.6, 7.8, 2.4, 1.0], stab: [21.0, 1.7, 3.8, 1.4, 0.7], rear: [2.0, 15.6, 1.4, 3.0] },
  turboprop: { scale: 0.95, fw: 2.0, y0: 2.0, y1: 22.6, wing: [8.6, 2.8, 11.2, 0.2, 1.7], stab: [19.6, 1.9, 4.4, 0.4, 1.2], nacelle: [4.2, 6.2, 1.5, 5.4], props: true },
  ga:        { scale: 0.8,  fw: 1.8, y0: 3.0, y1: 22.0, wing: [8.4, 2.7, 10.6, 0, 2.7], stab: [19.6, 1.8, 3.9, 0, 1.8], nose: true },
  heli:      { scale: 0.9,  heli: true },
};
/* ---------- 3D aircraft models ----------
   Body frame: X forward (nose), Y right wing, Z up. Built from the class proportions above
   (24-unit box: box y 0 = nose … 24 = tail, box x 12 = centerline). */
const wingZ = { ga: 0.9, turboprop: 0.85 };                      // high-wing types; others are low-wing
const tTail = { rearjet: true, bizjet: true, turboprop: true };
function buildMesh(kind) {
  const c = CLASSES[kind], faces = [], tips = {};
  const B = (bx, by, z) => [12 - by, bx - 12, z];                 // box → body
  const quad = (pts, part = 'skin') => faces.push({ pts, part });
  function lathe(yStations, radii, cx = 12, zc = 0, n = 10, sz = 1) {   // body of revolution along X
    const rings = yStations.map((y, i) => Array.from({ length: n }, (_, k) => { const t = k / n * Math.PI * 2; return B(cx + Math.cos(t) * radii[i], y, zc + Math.sin(t) * radii[i] * sz); }));
    for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < n; k++) quad([rings[i][k], rings[i][(k + 1) % n], rings[i + 1][(k + 1) % n], rings[i + 1][k]]);
    quad(rings[0].slice().reverse()); quad(rings[rings.length - 1]);
  }
  const disk = (cx, by, zc, r, axis, part) => {                    // propeller / rotor disc
    const n = 16; quad(Array.from({ length: n }, (_, k) => { const t = k / n * Math.PI * 2;
      return axis === 'x' ? B(cx + Math.cos(t) * r, by, zc + Math.sin(t) * r) : axis === 'y' ? B(cx, by + Math.cos(t) * r, zc + Math.sin(t) * r) : B(cx + Math.cos(t) * r, by + Math.sin(t) * r, zc); }), part);
  };
  if (c.heli) {
    lathe([5, 6.2, 8, 10.5, 12.8, 14], [0.4, 2.2, 3.0, 3.1, 2.2, 0.9], 12, 0, 12, 1.1);
    lathe([13.5, 21.5], [0.55, 0.35], 12, 0.9, 6);
    quad([B(12, 19.6, 0.9), B(12, 21.6, 0.9), B(12, 21.9, 3.4), B(12, 20.8, 3.4)]);         // tail fin
    disk(12.6, 21, 1.6, 1.7, 'y', 'rotor');                                                   // tail rotor
    disk(12, 9.5, 3.9, 11.2, 'z', 'rotor');                                                   // main rotor disc
    faces.push({ blades: true, center: B(12, 9.5, 4.0), r: 11.2 });
    tips.l = B(12, 21.6, 1.2); tips.r = tips.l; tips.beacon = B(12, 9.5, 3.4);
    return { faces, tips };
  }
  const h = c.fw / 2, y0 = c.y0, y1 = c.y1;
  lathe([y0, y0 + c.fw * 0.15, y0 + c.fw * 0.4, y0 + c.fw * 0.8, y0 + c.fw * 1.4, y1 - 4.5, y1 - 2.6, y1 - 1.2, y1], [0.08, h * 0.5, h * 0.78, h * 0.93, h, h, h * 0.78, h * 0.5, h * 0.22], 12, 0, 16);
  const wz = (wingZ[kind] ?? -0.35) * h;
  const wing = ([y, rc, span, sweep, tc], z, dihedral, part) => {
    for (const sg of [1, -1]) quad([B(12 + sg * h * 0.85, y, z), B(12 + sg * span, y + sweep, z + span * dihedral), B(12 + sg * span, y + sweep + tc, z + span * dihedral), B(12 + sg * h * 0.85, y + rc, z)], part);
  };
  wing(c.wing, wz, wz < 0 ? 0.06 : 0.01);
  const finH = c.fw * 1.25 + (kind === 'heavy' || kind === 'quad' ? 2.4 : 1.6);
  const [sy, src] = c.stab;
  quad([B(12, sy - 1.2, h * 0.6), B(12, y1 - 0.2, h * 0.4), B(12, y1 - 0.4, h + finH), B(12, sy + src * 0.4, h + finH)]);   // vertical fin
  wing(c.stab, tTail[kind] ? h + finH - 0.15 : h * 0.15, 0.03);
  for (const [x, y, w, l] of c.eng || []) for (const sg of [1, -1]) lathe([y, y + l], [w / 2, w * 0.42], 12 + sg * x, wz - w * 0.65 + x * 0.06, 8);
  if (c.rear) { const [x, y, w, l] = c.rear; for (const sg of [1, -1]) lathe([y, y + l], [w / 2, w * 0.4], 12 + sg * x, h * 0.35, 8); }
  if (c.nacelle) { const [x, y, w, l] = c.nacelle; for (const sg of [1, -1]) { lathe([y, y + l], [w / 2, w * 0.3], 12 + sg * x, wz - w * 0.35, 8); disk(12 + sg * x, y - 0.2, wz - w * 0.35, 2.1, 'x', 'prop'); } }
  if (c.nose) disk(12, y0 - 0.3, 0, 2.2, 'x', 'prop');
  const [wy, , span, sweep, tc] = c.wing, dz = wz + span * (wz < 0 ? 0.06 : 0.01);
  tips.l = B(12 - span, wy + sweep + tc * 0.4, dz); tips.r = B(12 + span, wy + sweep + tc * 0.4, dz);
  tips.tail = B(12, y1, h * 0.3); tips.beacon = B(12, (y0 + y1) / 2, -h);
  return { faces, tips };
}
const MESHES = {};
const meshFor = k => MESHES[k] || (MESHES[k] = buildMesh(k));

// Body axes in the world from track (heading over the ground) and flight-path angle (climb/descent).
function attitude(a) {
  const psi = rad(a.track ?? 0);
  const gam = (a.vrate != null && a.gs) ? Math.atan2(a.vrate / 60, a.gs * 1.68781) : 0;   // ft/s up vs ft/s along
  const fwd = [Math.sin(psi) * Math.cos(gam), Math.cos(psi) * Math.cos(gam), Math.sin(gam)];
  const right = [Math.cos(psi), -Math.sin(psi), 0];
  return { fwd, right, up: cross(right, fwd) };
}
const toWorld = (P, A) => add(add(scale(A.fwd, P[0]), scale(A.right, P[1])), scale(A.up, P[2]));

// Draw a model at screen point (sx, sy), seen along the true line of sight `los`.
function drawModel(kind, a, sx, sy, sizePx, los, B, T, light, now) {
  const M = meshFor(kind), A = attitude(a), k = sizePx / 24;
  let up = add(B.u, scale(los, -dot(B.u, los))); up = unit(up);
  const right = cross(los, up);
  const D = 64;                                                      // mild perspective for depth
  const toScreen = w => { const d = dot(w, los), ps = D / (D + d); return [sx + dot(w, right) * k * ps, sy - dot(w, up) * k * ps, d]; };
  // Studio-style key light from the viewer's upper left, so curves always read as 3D, plus the real sun.
  const key = unit(add(add(scale(los, -0.75), scale(up, 0.55)), scale(right, -0.4)));
  const half = unit(add(key, scale(los, -1)));
  const polys = [];
  for (const f of M.faces) {
    if (f.blades) {                                                  // spinning rotor blades
      const c = toWorld(f.center, A), t = now / 90;
      for (const off of [0, Math.PI / 2]) {
        const d = add(scale(A.fwd, Math.cos(t + off) * f.r), scale(A.right, Math.sin(t + off) * f.r)), w = add(scale(A.fwd, -Math.sin(t + off) * 0.5), scale(A.right, Math.cos(t + off) * 0.5));
        const pts = [add(add(c, d), w), add(add(c, d), scale(w, -1)), add(add(c, scale(d, -1)), scale(w, -1)), add(add(c, scale(d, -1)), w)].map(toScreen);
        polys.push({ pts, depth: pts.reduce((s, p) => s + p[2], 0) / 4, part: 'blade', n: A.up });
      }
      continue;
    }
    const W = f.pts.map(P => toWorld(P, A));
    const n = unit(cross(add(W[1], scale(W[0], -1)), add(W[2], scale(W[0], -1))));
    const pts = W.map(toScreen);
    polys.push({ pts, depth: pts.reduce((s, p) => s + p[2], 0) / pts.length, part: f.part, n });
  }
  polys.sort((p, q) => q.depth - p.depth);                         // painter's algorithm: far faces first
  const base = T.phase === 'day' ? [236, 241, 248] : T.phase === 'dusk' ? [214, 206, 214] : [150, 166, 196];
  const night3d = T.phase === 'night';
  // Outline pass so the model stands out against bright or dark sky.
  ctx.lineJoin = 'round'; ctx.strokeStyle = T.planeEdge; ctx.lineWidth = 2.2;
  for (const p of polys) { if (p.part !== 'skin') continue; ctx.beginPath(); p.pts.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.closePath(); ctx.stroke(); }
  for (const p of polys) {
    let n = p.n; if (dot(n, los) > 0) n = scale(n, -1);             // the side facing you
    const diffuse = (night3d ? 0.34 : 0.24) + 0.5 * Math.max(0, dot(n, key)) + 0.3 * Math.max(0, dot(n, light)) + 0.12 * Math.max(0, -n[2]);
    const spec = p.part === 'skin' ? 0.45 * Math.pow(Math.max(0, dot(n, half)), 28) : 0;
    ctx.beginPath(); p.pts.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.closePath();
    if (p.part === 'rotor' || p.part === 'prop') { ctx.fillStyle = T.phase === 'day' ? 'rgba(40,50,70,.18)' : 'rgba(220,230,255,.16)'; ctx.fill(); continue; }
    const col = p.part === 'blade' ? base.map(v => Math.round(v * 0.45)) : base.map(v => Math.round(Math.min(255, v * Math.min(1.1, diffuse) + 255 * spec)));
    ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`; ctx.fill();
    ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 0.6; ctx.stroke();                         // hide seams
  }
  // Lights: red left wingtip, green right, white tail; strobes and a red beacon at night.
  const L = (P, color, r) => { const q = toScreen(toWorld(P, A)); ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = 10; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, 7); ctx.fill(); ctx.restore(); };
  const night = T.phase !== 'day', tip = M.tips;
  if (tip.l && tip.r && tip.l !== tip.r) { L(tip.l, '#ff3b3b', night ? 3.2 : 2.2); L(tip.r, '#2dff86', night ? 3.2 : 2.2); }
  if (night) {
    if (tip.tail) L(tip.tail, '#ffffff', 2.4);
    if (now % 1300 < 90 && tip.l !== tip.r) { L(tip.l, '#ffffff', 5); L(tip.r, '#ffffff', 5); }
    if (now % 1000 < 140 && tip.beacon) L(tip.beacon, '#ff2a2a', 3.4);
  }
}

function classOf(a) {
  const t = (a.type || '').toUpperCase(), cat = a.category || '';
  if (cat === 'A7' || /^(R22|R44|R66|EC\d|AS\d|B06|B407|B412|B429|S76|S92|A109|A119|A139|A169|H60|H500|MD\d{3}|BK17|EH10|UH1|H47)/.test(t)) return 'heli';
  if (/^(B74.|A38.|A34.|C17|K35R|E3TF|E6)$/.test(t)) return 'quad';
  if (/^(B76.|B77.|B78.|A30.|A310|A33.|A35.|MD11|DC10|L101|C5M|KC10|K46)$/.test(t)) return 'heavy';
  if (/^(CRJ|E135|E145|E35L|MD8|MD9|B712|F100|F70|DC9)/.test(t)) return 'rearjet';
  if (/^(C5\d|C6[58]|C68A|C700|C750|CL3|CL6|GL|GLF|G[2-7]|FA[0-9]|F2TH|F900|LJ|E50P|E55P|E545|E550|HDJT|PC24|SF50|BE40|H25|PRM1|EA50|C25)/.test(t)) return 'bizjet';
  if (/^(AT4|AT7|ATR|DH8|DHC|SF34|E120|B190|BE20|BE30|B350|BE9|PC12|C208|C30J|C130|TBM|KODI|P180|SW4|D328|JS3|PAY|PA31T|P46T|MU2|AN2)/.test(t)) return 'turboprop';
  if (/^(C1[5-8]\d|C2[01]\d|P28|PA2|PA3|PA4|PA1|SR2|BE3[356]|BE2|M20|DA4|DA2|RV|AA5|C42|J3|GLAS|COL|EVOT|LNC)/.test(t)) return 'ga';
  return { A1: 'ga', A2: 'bizjet', A3: 'narrow', A4: 'narrow', A5: 'heavy', A6: 'bizjet', B1: 'ga', B4: 'ga' }[cat] || 'narrow';
}
const CARD = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/* ---------- rendering ---------- */
let canvas, ctx, video, raf = 0, running = false, cameraOn = false, markers = [], hintSince = 0;
let roll = 0, rollQ = 0, edgeHits = [];               // text tilt to stay level with the horizon; HUD turns in 90° steps
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
      if (onScreen(p)) leveled(p.x, p.y, () => { ctx.font = '600 14px -apple-system,system-ui,sans-serif'; ctx.fillStyle = T.soft; ctx.fillText(`${el}°`, 5, -5); });
    }
  }
  ctx.setLineDash([]);
  ctx.font = '800 18px -apple-system,system-ui,sans-serif'; ctx.textAlign = 'center';
  for (let i = 0; i < 8; i++) {
    const p = project(fromAzEl(i * 45, 0), B);
    if (!onScreen(p)) continue;
    leveled(p.x, p.y, () => { ctx.font = '800 18px -apple-system,system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = T.line; ctx.fillText(CARD[i], 0, -10); });
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
    if (onScreen(sp, -20)) label(sp.x, sp.y, rS + 18, 'Sun · don’t look directly', T, true);
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
    if (onScreen(mp, -20)) label(mp.x, mp.y, r + 18, `Moon · ${Math.round(moon.lit * 100)}% lit`, T, true);
  }
}
// Draw with the text kept level with the horizon, anchored at (x, y).
function leveled(x, y, fn) { ctx.save(); ctx.translate(x, y); ctx.rotate(roll); fn(); ctx.restore(); }
function label(x, y, dy, text, T, small) {
  leveled(x, y, () => {
    ctx.font = `${small ? 600 : 700} ${small ? 14 : 16}px -apple-system,system-ui,sans-serif`;
    const w = ctx.measureText(text).width + 18, h = small ? 24 : 28;
    ctx.fillStyle = T.pill; roundRect(-w / 2, dy - h / 2, w, h, h / 2); ctx.fill();
    ctx.fillStyle = T.pillInk; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 0, dy + 0.5);
  });
}
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

function fmtAltShort(ft) { return O.metric ? `${Math.round(ft * 0.3048).toLocaleString()} m` : ft >= 18000 ? `FL${Math.round(ft / 100)}` : `${Math.round(ft / 100) * 100 >= 1000 ? (Math.round(ft / 100) * 100).toLocaleString() : Math.round(ft)} ft`; }
function fmtRange(m) { return O.metric ? `${(m / 1000).toFixed(1)} km` : `${(m / 1609.344).toFixed(1)} mi`; }

function drawAircraft(B, T, here, now) {
  markers = [];
  const sun = O.sunPos(here.lat, here.lon, new Date(now));
  const light = sun.alt > 0 ? fromAzEl(sun.az, sun.alt) : unit([0.3, 0.2, 1]);
  const list = O.all.filter(a => a.lat != null && a.alt != null && O.distMi(here.lat, here.lon, a.lat, a.lon) <= SKY_RANGE_MI);
  const items = list.map(a => {
    const p = extrapolate(a, now), sp = skyPoint(here, p);
    return { a, p, sp, v: fromAzEl(sp.az, sp.el) };
  }).sort((x, y) => y.sp.range - x.sp.range);           // far first, near on top
  const edge = [];
  for (const it of items) {
    const s = project(it.v, B);
    if (!onScreen(s, 10)) { edge.push({ it, s }); continue; }
    const kind = classOf(it.a);
    const size = Math.max(72, Math.min(170, 6400 / Math.sqrt(it.sp.range))) * CLASSES[kind].scale;
    // Subtle halo: green closing, amber at its closest, red moving away.
    const hc = HALO[closure(here, it.p, it.a)], hr = size * 0.78;
    const hg = ctx.createRadialGradient(s.x, s.y, size * 0.12, s.x, s.y, hr);
    hg.addColorStop(0, `rgba(${hc},${T.phase === 'day' ? 0.42 : 0.5})`); hg.addColorStop(0.6, `rgba(${hc},${T.phase === 'day' ? 0.2 : 0.26})`); hg.addColorStop(1, `rgba(${hc},0)`);
    ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(s.x, s.y, hr, 0, Math.PI * 2); ctx.fill();
    drawModel(kind, it.a, s.x, s.y, size, it.v, B, T, light, now);
    // Label below the aircraft.
    const name = O.flightLabel(it.a);
    let typ = O.typeName(it.a) || ''; if (typ.length > 26) typ = typ.slice(0, 25) + '…';
    const line2 = `${fmtAltShort(it.p.alt)} · ${fmtRange(it.sp.range)} · ${Math.round(it.sp.el)}° up`;
    const asp = aspect(it.sp, it.a);
    ctx.font = '700 18px -apple-system,system-ui,sans-serif';
    const w1 = ctx.measureText(name).width;
    ctx.font = '500 14.5px -apple-system,system-ui,sans-serif';
    const w2 = Math.max(ctx.measureText(line2).width, ctx.measureText(typ).width, asp ? ctx.measureText(asp).width : 0);
    const bw = Math.max(w1, w2) + 22, bh = asp ? 86 : 68;
    // Put the box below the aircraft (in the leveled frame), or above it if that would run off screen.
    let off = size * 0.55 + 8;
    const at = d => [s.x - Math.sin(roll) * d, s.y + Math.cos(roll) * d];
    const [cxB, cyB] = at(off + bh / 2);
    const hx = rollQ % 2 ? bh / 2 : bw / 2, hy = rollQ % 2 ? bw / 2 : bh / 2, M = margins(false);
    if (cxB - hx < M.left - 26 || cxB + hx > W - M.right + 26 || cyB - hy < M.top - 26 || cyB + hy > H - M.bottom + 26) off = -(size * 0.55 + 8) - bh;
    let shift = 0;
    if (Math.abs(roll) < 0.3) shift = Math.max(8 - (s.x - bw / 2), Math.min(0, W - 8 - (s.x + bw / 2)));
    leveled(s.x, s.y, () => {
      ctx.fillStyle = T.pill; roundRect(shift - bw / 2, off, bw, bh, 11); ctx.fill();
      ctx.fillStyle = T.pillInk; ctx.textAlign = 'center';
      ctx.font = '700 18px -apple-system,system-ui,sans-serif'; ctx.fillText(name, shift, off + 21);
      ctx.font = '500 14.5px -apple-system,system-ui,sans-serif'; ctx.globalAlpha = 0.9;
      ctx.fillText(typ, shift, off + 40); ctx.fillText(line2, shift, off + 58);
      if (asp) ctx.fillText(asp, shift, off + 76);
      ctx.globalAlpha = 1;
    });
    const [lx, ly] = at(off + bh / 2);
    const bx = lx + shift - bw / 2, by = ly - bh / 2;
    markers.push({ hex: it.a.hex, x: s.x, y: s.y, r: size * 0.6, box: [bx, by, bw, bh], lc: [lx + shift, ly], lr: Math.max(bw, bh) / 2 });
  }
  // Off-screen aircraft: arrows on the edge pointing the way to turn.
  edge.sort((x, y) => x.it.sp.range - y.it.sp.range);
  const placed = [];
  edgeHits = [];
  for (const { it, s } of edge.slice(0, 5)) {
    let dx = s.cx, dy = -s.cy;
    if (s.z <= 0.02 && Math.hypot(dx, dy) < 0.05) dy = 1;      // directly behind: suggest turning around
    const ang = Math.atan2(dy, dx), M = margins();
    const cx0 = (M.left + W - M.right) / 2, cy0 = (M.top + H - M.bottom) / 2;
    const kx = ((W - M.left - M.right) / 2) / Math.abs(Math.cos(ang) || 1e-6), ky = ((H - M.top - M.bottom) / 2) / Math.abs(Math.sin(ang) || 1e-6);
    const k = Math.min(kx, ky), ex = cx0 + Math.cos(ang) * k;
    let ey = cy0 + Math.sin(ang) * k;
    // Spread arrows along their edge so labels don't overlap (turned labels run along the edge).
    const ext = rollQ % 2 ? { x: 40, y: 170 } : { x: 175, y: 60 };
    const vertEdge = Math.abs(Math.cos(ang)) * (H - M.top - M.bottom) > Math.abs(Math.sin(ang)) * (W - M.left - M.right);
    let ex2 = ex;
    const inward = rollQ % 2 ? [40, 90] : [90, 40];
    const lblAt = (x, y) => { let lx = x - Math.cos(ang) * inward[0], ly = y - Math.sin(ang) * inward[1];
      if (rollQ % 2) ly = Math.max(95, Math.min(H - 95, ly)); else lx = Math.max(90, Math.min(W - 90, lx));   // keep the label on screen
      return [lx, ly]; };
    const blocked = (x, y) => { const [lx, ly] = lblAt(x, y);
      if (placed.some(q => Math.abs(q.x - x) < ext.x && Math.abs(q.y - y) < ext.y)) return true;
      return markers.some(m => {
        const hw = (rollQ % 2 ? m.box[3] : m.box[2]) / 2 + ext.x / 2, hh = (rollQ % 2 ? m.box[2] : m.box[3]) / 2 + ext.y / 2;
        return (Math.abs(lx - m.lc[0]) < hw && Math.abs(ly - m.lc[1]) < hh) || Math.hypot(x - m.x, y - m.y) < m.r + 24 || Math.hypot(lx - m.x, ly - m.y) < m.r + 50; }); };
    // Slide along the edge (alternating sides) until the arrow and its label are clear.
    const base = vertEdge ? ey : ex2;
    for (let step = 1; step < 14 && blocked(ex2, ey); step++) {
      const d = Math.ceil(step / 2) * (vertEdge ? ext.y : ext.x) * 0.5 * (step % 2 ? 1 : -1);
      if (vertEdge) ey = base + d; else ex2 = base + d;
    }
    if (ey < M.top || ey > H - M.bottom || ex2 < M.left - 20 || ex2 > W - M.right + 20 || blocked(ex2, ey)) continue;   // no room: skip
    placed.push({ x: ex2, y: ey });
    edgeHits.push({ hex: it.a.hex, x: ex2, y: ey, r: 30 });
    ctx.save(); ctx.translate(ex2, ey); ctx.rotate(ang);
    ctx.fillStyle = T.pill; ctx.beginPath(); ctx.arc(0, 0, 20, 0, 7); ctx.fill();
    ctx.fillStyle = T.pillInk; ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(-5, -8.5); ctx.lineTo(-5, 8.5); ctx.closePath(); ctx.fill();
    ctx.restore();
    const txt = `${O.flightLabel(it.a)} · ${fmtRange(it.sp.range)}`;
    const [lx2, ly2] = lblAt(ex2, ey);
    label(lx2, ly2, 0, txt, T, true);
    edgeHits.push({ hex: it.a.hex, x: lx2, y: ly2, r: rollQ % 2 ? 26 : 60, rx: rollQ % 2 ? 18 : 80, ry: rollQ % 2 ? 80 : 18 });
  }
}
function drawStatus(B) {
  const az = norm360(deg(Math.atan2(B.f[0], B.f[1]))), el = deg(Math.asin(Math.max(-1, Math.min(1, B.f[2]))));
  $('ar-facing').textContent = `Facing ${CARD[Math.round(az / 45) % 8]} ${Math.round(az)}° · ${el >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(el))}°`;
  const here = O.here, n = here ? O.all.filter(a => O.distMi(here.lat, here.lon, a.lat, a.lon) <= SKY_RANGE_MI).length : 0;
  $('ar-count').textContent = n ? `${n} aircraft within ${O.metric ? '16 km' : '10 mi'}` : `No aircraft within ${O.metric ? '16 km' : '10 mi'} right now`;
  const poor = view.accuracy != null && (view.accuracy < 0 || view.accuracy > 25);
  const hint = $('ar-hint');
  if (hint.dataset.locked) return;
  const msg = poor ? 'Compass needs calibrating: wave the phone in a figure 8.'
    : view.nudge ? `Aligned ${view.nudge > 0 ? '+' : ''}${Math.round(view.nudge)}° · double-tap to reset`
    : 'Tap a plane for details · drag sideways to line it up.';
  hint.textContent = msg;
  hint.hidden = !poor && performance.now() - hintSince > 6000;
}
// Space kept clear for the readout (on whichever side is "up") and the tip (opposite).
function margins(withHint = true) {
  const m = { top: 34, right: 34, bottom: 34, left: 34 }, sides = ['top', 'right', 'bottom', 'left'];
  m[sides[rollQ % 4]] = 100; if (withHint) m[sides[(rollQ + 2) % 4]] = 96;
  return m;
}
function updateRoll(B) {
  const a = B.r[2], b = B.u[2];                                // where "up" in the world appears on screen
  if (Math.hypot(a, b) > 0.15) {                                // looking almost straight up: keep the last tilt
    const d = Math.atan2(Math.sin(Math.atan2(a, b) - roll), Math.cos(Math.atan2(a, b) - roll));
    roll = Math.atan2(Math.sin(roll + d * 0.3), Math.cos(roll + d * 0.3));
  }
  const q = (((Math.round(roll / (Math.PI / 2))) % 4) + 4) % 4;
  const near = Math.abs(Math.atan2(Math.sin(roll - q * Math.PI / 2), Math.cos(roll - q * Math.PI / 2))) < Math.PI / 4 - 0.12;
  if (q !== rollQ && near) { rollQ = q; placeHUD(); }
}
function placeHUD() {
  const ui = $('ar-ui'); if (!ui) return;
  const turn = rollQ === 3 ? -90 : rollQ * 90, side = rollQ % 2 === 1;
  ui.classList.toggle('turned', rollQ !== 0);
  Object.assign(ui.style, side
    ? { width: `${H}px`, height: `${W}px`, left: `${(W - H) / 2}px`, top: `${(H - W) / 2}px`, transform: `rotate(${turn}deg)` }
    : { width: `${W}px`, height: `${H}px`, left: '0px', top: '0px', transform: `rotate(${turn}deg)` });
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
  updateRoll(B);
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
  O.setSkyRange(SKY_RANGE_MI);
  roll = 0; rollQ = 0; placeHUD();
  running = true; frame();
  try { await navigator.wakeLock?.request('screen'); } catch { /* optional */ }
}
function close() {
  running = false; cancelAnimationFrame(raf);
  window.removeEventListener('deviceorientationabsolute', onOrientation, true);
  window.removeEventListener('deviceorientation', onOrientation, true);
  if (video?.srcObject) { video.srcObject.getTracks().forEach(t => t.stop()); video.srcObject = null; }
  cameraOn = false; view.basis = null;
  O.setSkyRange(0);
  $('ar').hidden = true; document.body.classList.remove('ar-open');
}

/* ---------- touch: tap a marker for details, drag sideways to align ---------- */
let drag = null;
function pointerDown(e) { drag = { x: e.clientX, y: e.clientY, start: view.nudge, moved: false, t: performance.now() }; }
function pointerMove(e) {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  if (Math.abs(dx) > 18) drag.moved = true;                    // small finger wobble still counts as a tap
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
  // Hit test: the aircraft model, its label box (which may be tilted), then the edge arrows and their labels.
  const inLabel = m => { const dx = x - m.lc[0], dy = y - m.lc[1], c = Math.cos(-roll), s = Math.sin(-roll);
    return Math.abs(dx * c - dy * s) < m.box[2] / 2 + 12 && Math.abs(dx * s + dy * c) < m.box[3] / 2 + 12; };
  const hit = [...markers].reverse().find(m => Math.hypot(m.x - x, m.y - y) < Math.max(44, m.r) || inLabel(m))
    || edgeHits.find(h => h.rx ? Math.abs(x - h.x) < h.rx && Math.abs(y - h.y) < h.ry : Math.hypot(x - h.x, y - h.y) < h.r);
  if (hit) { lastTap = 0; O.openDetail(hit.hex); }
}

document.addEventListener('DOMContentLoaded', init);
if (document.readyState !== 'loading') init();
let inited = false;
function init() {
  if (inited) return; inited = true;
  $('skyBtn')?.addEventListener('click', open);
  $('ar-close')?.addEventListener('click', close);
  const c = $('ar-canvas');
  if (!c) return;
  c.addEventListener('pointerdown', pointerDown);
  c.addEventListener('pointermove', pointerMove);
  c.addEventListener('pointerup', pointerUp);
  c.addEventListener('pointercancel', () => { drag = null; });
  const reflow = () => { if (running) { resize(); placeHUD(); } };
  window.addEventListener('resize', reflow);
  window.addEventListener('orientationchange', () => setTimeout(reflow, 250));
  screen.orientation?.addEventListener?.('change', () => setTimeout(reflow, 250));
  document.addEventListener('visibilitychange', () => { if (document.hidden && running) close(); });
  if (location.hash === '#sky') open();
}

// Exposed for testing the math without sensors.
window.OverheadAR = { get _hits() { return { markers, edgeHits }; }, closure, classOf, attitude, buildMesh, deviceAxes, cameraBasis, fromAzEl, project: (v, B, w, h) => { W = w; H = h; FPX = (Math.max(w, h) / 2) / Math.tan(rad(LONG_FOV / 2)); return project(v, B); }, aspect, skyPoint };
})();
