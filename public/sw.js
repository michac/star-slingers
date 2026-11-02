// Dependency-free service worker for Star Slingers (B12 PWA).
// Strategy: install-time precache the small stable assets; network-first for
// navigations (fresh deploys online, cached shell offline); cache-first for
// other same-origin assets (hashed JS self-busts — new build = new filename).
// Subpath- and base-agnostic: all URLs relative, scope = this file's directory.
// Never cache a redirected response: WebKit refuses to load a page answered with
// one, and the Cloudflare host redirects x.html → x (see wrangler.jsonc). So no
// HTML in PRECACHE. `npm run test:pwa` (e2e-pwa/sw-offline.spec.ts) enforces it.
// Bump only when cached entries must be dropped: a bump deletes the old cache,
// offline shell included, until the next online visit refills it.
const CACHE = 'star-slingers-v1';
const PRECACHE = [
  './manifest.webmanifest',
  './fonts/Audiowide-Regular.woff2',
  './icons/icon-192.png', './icons/icon-512.png',
  './icons/maskable-512.png', './icons/apple-touch-icon-180.png',
];
self.addEventListener('install', (e) =>
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) =>
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())));
// Only cache clean, complete, same-origin responses (no opaque/206/error poisoning).
const cacheable = (r) => r && r.status === 200 && r.type === 'basic';
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req)
      .then((r) => { if (cacheable(r)) { const c = r.clone(); caches.open(CACHE).then((x) => x.put(req, c)); } return r; })
      // Offline: this page as cached (any query string — `?controls=v2` is the same
      // page), else the game shell. Navigations are cached under their own URL.
      .catch(() => caches.match(req, { ignoreSearch: true }).then((h) => h || caches.match('./'))));
    return;
  }
  e.respondWith(caches.match(req).then((h) => h ||
    fetch(req).then((r) => { if (cacheable(r)) { const c = r.clone(); caches.open(CACHE).then((x) => x.put(req, c)); } return r; })));
});
