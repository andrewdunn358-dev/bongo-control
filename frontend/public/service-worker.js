/* Bongo Control — minimal offline shell service worker.
   Caches the app shell (index + built assets) and serves them cache-first
   when offline. API calls (/api/*) and the WebSocket are always network-only
   so we never serve stale telemetry. */

const VERSION = 'bongo-shell-v1';
const CORE = ['/', '/index.html', '/manifest.json', '/icon.svg', '/apple-touch-icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(CORE).catch(() => null)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Never touch API or WebSocket traffic
  if (req.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/ws/')) return;

  // Same-origin only for shell caching
  if (url.origin !== self.location.origin) {
    // For fonts / map tiles: use stale-while-revalidate
    if (
      url.hostname.endsWith('cartocdn.com') ||
      url.hostname === 'fonts.googleapis.com' ||
      url.hostname === 'fonts.gstatic.com'
    ) {
      event.respondWith(staleWhileRevalidate(req));
    }
    return;
  }

  // App shell: cache-first, fall back to network, then to cached index for SPA routes
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          const copy = res.clone();
          if (res.ok) {
            caches.open(VERSION).then((cache) => cache.put(req, copy)).catch(() => null);
          }
          return res;
        })
        .catch(() => caches.match('/index.html'));
    }),
  );
});

async function staleWhileRevalidate(req) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone()).catch(() => null);
      return res;
    })
    .catch(() => cached);
  return cached || network;
}
