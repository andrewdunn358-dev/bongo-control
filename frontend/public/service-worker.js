/* Bongo Control — offline shell service worker.

   Strategy, and why it matters:

   - HTML / navigations: NETWORK-FIRST, falling back to cache.
     This is the important one. Vite emits content-hashed asset
     filenames (index-A1b2C3.js), so a new build produces entirely new
     asset names. index.html is the only file that knows those names.
     Serving a cached index.html therefore pins the app to the build
     that was first installed - the new assets exist on the server but
     nothing ever asks for them. That is exactly what happened after
     the aurora redesign: desktop updated (hard refresh bypasses the
     SW) while mobile stayed on the old build indefinitely, and no
     amount of reinstalling the PWA icon fixed it, because the icon
     isn't what holds the cache.

   - Hashed assets under /assets/: CACHE-FIRST, which is safe
     precisely because the filename changes when the content does.

   - /api/* and /ws/*: never touched. Always network, so telemetry is
     never stale.

   - Fonts and map tiles: stale-while-revalidate.
*/

const VERSION = 'bongo-shell-v2';
const CORE = ['/', '/index.html', '/manifest.json', '/icon.svg', '/apple-touch-icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(CORE).catch(() => null)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/ws/')) return;

  // Cross-origin: fonts and map tiles only.
  if (url.origin !== self.location.origin) {
    if (
      url.hostname.endsWith('cartocdn.com') ||
      url.hostname === 'fonts.googleapis.com' ||
      url.hostname === 'fonts.gstatic.com'
    ) {
      event.respondWith(staleWhileRevalidate(req));
    }
    return;
  }

  // Navigations and HTML - network-first so a new build is picked up.
  const isNavigation = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  if (isNavigation) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Content-hashed build output - cache-first is safe here.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Everything else same-origin (icons, manifest): revalidate in the
  // background so it can't pin either.
  event.respondWith(staleWhileRevalidate(req));
});

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone()).catch(() => null);
    return res;
  } catch {
    // Offline: serve the cached page, or the shell for an SPA route
    // that was never visited online.
    return (await cache.match(req)) || (await cache.match('/index.html')) || Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone()).catch(() => null);
  return res;
}

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
