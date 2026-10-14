/* Overhead service worker: app shell offline, live data always from the network. */
const VERSION = 'overhead-v13';
const SHELL = ['./', 'index.html', 'app.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];
const PHOTOS = 'overhead-photos';
const FONTS = 'overhead-fonts';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => ![VERSION, PHOTOS, FONTS].includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trim(name, max) {
  const c = await caches.open(name); const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // App shell: network first so updates appear right away; cached copy when offline.
  if (url.origin === location.origin) {
    if (url.pathname.endsWith('.json')) return; // a local receiver's aircraft.json must stay live
    e.respondWith(caches.open(VERSION).then(async c => {
      try {
        const r = await fetch(req, { cache: 'no-cache' });
        if (r.ok) c.put(req, r.clone());
        return r;
      } catch {
        return (await c.match(req, { ignoreSearch: true })) || (await c.match('index.html')) || Response.error();
      }
    }));
    return;
  }
  // Aircraft photos: cache first, keep the newest 200.
  if (/(^|\.)planespotters\.net$|airport-data\.com$/.test(url.hostname) && req.destination === 'image') {
    e.respondWith(caches.open(PHOTOS).then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      const r = await fetch(req); c.put(req, r.clone()); trim(PHOTOS, 200); return r;
    }));
    return;
  }
  // Fonts: cache first.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONTS).then(async c => (await c.match(req)) || fetch(req).then(r => { c.put(req, r.clone()); return r; })));
  }
  // Everything else (ADS-B and route APIs) goes straight to the network.
});
