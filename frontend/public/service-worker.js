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

// __BUILD_ID__ is replaced at build time with a unique per-build id (see
// the swVersion plugin in vite.config.ts). This is what makes updates
// actually reach devices: the app is a long-lived single-page PWA, so
// after first load there are no full navigations and the browser never
// re-runs network-first on index.html on its own. The browser DOES
// re-check service-worker.js (byte-for-byte) whenever the running app
// calls registration.update() - but only re-installs if the file
// changed. With a hardcoded version the bytes were identical every
// build, so mobile silently stayed on whatever build it first cached.
// Stamping a fresh id per build guarantees the bytes differ, so each
// deploy is detected, installed, and (via skipWaiting + claim +
// controllerchange) picked up. See index.html for the update polling.
const VERSION = 'bongo-shell-__BUILD_ID__';
const CORE = ['/', '/index.html', '/manifest.json', '/icon.svg', '/apple-touch-icon.svg'];

// Map assets live in their OWN cache, with a name that is deliberately
// NOT stamped with the build id.
//
// This is the whole reason maps were a black rectangle offline. Tiles
// were being cached correctly - into the VERSION cache - and then
// activate() below deleted every cache whose name wasn't the CURRENT
// VERSION. Since VERSION changes on every single build, every deploy
// silently threw away every tile the van had ever downloaded. The
// cache appeared to work all day and was empty again the moment
// anything shipped, which is exactly the sort of bug you don't notice
// until you're parked somewhere with no signal.
//
// Keeping map data in a separately-named cache decouples it from the
// app shell's lifecycle: shipping a new build no longer costs you the
// area you saved before setting off.
const MAP_CACHE = 'bongo-maps-v1';

// Bound it so it can't grow forever on a tablet. Cache API keys() come
// back in insertion order, so trimming from the front is roughly
// least-recently-*added* eviction. ~4000 vector tiles is on the order
// of a couple of hundred MB at the top end, and comfortably holds
// several saved areas.
const MAP_CACHE_MAX_ENTRIES = 4000;

// keys() is O(cache), so don't walk it on every single tile write -
// during a "save this area" prefetch that would be hundreds of full
// scans. Checking every 50th put keeps the cache within a rounding
// error of the cap for a fraction of the work.
const TRIM_CHECK_EVERY = 50;
let putsSinceTrim = 0;

/** Map style, glyphs, sprites and tiles - everything MapLibre needs. */
function isMapAsset(url) {
  return url.hostname === 'cartocdn.com' || url.hostname.endsWith('.cartocdn.com');
}

/** Tiles and glyph ranges are immutable for a given URL, so they're
 *  cache-first: no revalidation request at all. That isn't just speed -
 *  the van is on a metered 4G SIM, and re-checking thousands of tiles
 *  that cannot have changed is real money. The small manifests
 *  (style.json, tiles.json, sprite) DO change when Carto update the
 *  style, so those revalidate in the background instead. */
function isImmutableMapAsset(url) {
  return /\.(pbf|mvt)$/.test(url.pathname);
}

self.addEventListener('install', (event) => {
  // NOTE: deliberately NO self.skipWaiting() here. On a deploy, the new
  // worker enters the "waiting" state (an old controller is running)
  // instead of activating immediately. That's what lets the in-app
  // UpdateBanner detect it and offer a *consenting* reload, rather than
  // every open tab hard-reloading itself mid-use — mid roof-hold, mid
  // camera view — the moment a deploy lands. Activation happens only when
  // the user clicks Reload (which posts SKIP_WAITING below).
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(CORE).catch(() => null)));
});

// The in-app UpdateBanner's "Reload" button posts this to activate the
// waiting worker on demand — the only path that skips waiting now.
self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') self.skipWaiting();

  // Settings shows how much is saved and offers to clear it. Replying
  // on the message port keeps this a plain request/response rather than
  // needing a second channel back to the page.
  if (event.data.type === 'MAP_CACHE_STATS') {
    event.waitUntil(
      caches
        .open(MAP_CACHE)
        .then((cache) => cache.keys())
        .then((keys) => event.ports[0] && event.ports[0].postMessage({ entries: keys.length }))
        .catch(() => event.ports[0] && event.ports[0].postMessage({ entries: 0 })),
    );
  }

  if (event.data.type === 'CLEAR_MAP_CACHE') {
    event.waitUntil(
      caches
        .delete(MAP_CACHE)
        .then((ok) => event.ports[0] && event.ports[0].postMessage({ cleared: ok }))
        .catch(() => event.ports[0] && event.ports[0].postMessage({ cleared: false })),
    );
  }
});

// Caches to keep on activate. MAP_CACHE is here precisely so a deploy
// doesn't wipe saved map areas — see the comment on its definition.
const KEEP_CACHES = [VERSION, MAP_CACHE];

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP_CACHES.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/ws/')) return;
  // Always hit the network for the version probe - caching it would
  // defeat the whole point (the app couldn't tell a new build shipped).
  if (url.pathname === '/version.json') return;

  // Cross-origin: fonts and map assets only.
  if (url.origin !== self.location.origin) {
    if (isMapAsset(url)) {
      event.respondWith(isImmutableMapAsset(url) ? cacheFirst(req, MAP_CACHE) : staleWhileRevalidate(req, MAP_CACHE));
      return;
    }
    // Web fonts go in the persistent cache too. They were being wiped
    // by the same deploy-time purge, which meant the UI fell back to
    // system fonts offline after any update.
    if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
      event.respondWith(staleWhileRevalidate(req, MAP_CACHE));
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

/** cache.put + opportunistic trimming, so the map cache stays bounded. */
async function putBounded(cache, req, res, cacheName) {
  try {
    await cache.put(req, res);
  } catch {
    return; // quota, opaque response, etc - never fatal to the fetch
  }
  if (cacheName !== MAP_CACHE) return;
  putsSinceTrim += 1;
  if (putsSinceTrim < TRIM_CHECK_EVERY) return;
  putsSinceTrim = 0;
  try {
    const keys = await cache.keys();
    const excess = keys.length - MAP_CACHE_MAX_ENTRIES;
    if (excess > 0) await Promise.all(keys.slice(0, excess).map((k) => cache.delete(k)));
  } catch {
    /* trimming is best-effort */
  }
}

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

async function cacheFirst(req, cacheName = VERSION) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) putBounded(cache, req, res.clone(), cacheName);
  return res;
}

async function staleWhileRevalidate(req, cacheName = VERSION) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res.ok) putBounded(cache, req, res.clone(), cacheName);
      return res;
    })
    .catch(() => cached);
  return cached || network;
}
