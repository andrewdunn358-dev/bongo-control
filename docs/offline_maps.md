# Offline maps

Every map in VanOS (Trips, Coverage) is MapLibre against Carto's hosted
dark-matter basemap. That means map tiles come off the internet — which
is a problem in a van, because the whole point is being somewhere that
hasn't got any.

This document covers what now works offline, what still doesn't, and why
the obvious fix isn't the right one.

## What was actually broken

Not what it looked like. The service worker *was* caching map tiles
correctly all along. The bug was one line in `activate()`:

```js
keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))
```

`VERSION` is stamped with a fresh build id on every single build (see
the `swVersion` plugin in `vite.config.ts` — that's deliberate, it's
what makes updates reach devices). So every deploy deleted every cache
that wasn't the *brand new* one, which is all of them, including every
map tile the van had ever downloaded.

The symptom is nasty because it hides: maps cache fine all day, look
fine in testing, and are empty again the moment anything ships. You
find out about it parked in a valley.

**Fix:** map data lives in its own cache, `bongo-maps-v1`, whose name is
deliberately *not* build-stamped, and `activate()` keeps it. Shell
tidying is unchanged — stale build caches are still purged.

## What you get now

- **Anywhere you've looked at while online stays viewable offline**, and
  survives updates.
- **"Save this area"** — a button on every map. Downloads the current
  view plus two zoom levels in, so you can deliberately pull a valley
  down before you set off. Capped at 1200 tiles per press (roughly
  30–60 MB) because this is a metered SIM and tile counts quadruple per
  zoom level; the button shows exactly how many it's fetching.
- **An honest failure state.** If the device is offline *and* map
  requests fail, the map says the area wasn't saved instead of showing a
  black rectangle. It only says that when genuinely offline — MapLibre
  aborts requests during fast panning too, and a warning that cries wolf
  is a warning you learn to ignore.
- **Settings → Offline maps** shows how many tiles are stored and can
  clear them. Counted in tiles, not MB: the Cache API won't report real
  byte size without reading every entry back, and a made-up MB figure is
  exactly the kind of invented number this project doesn't do.

Caching policy, in `public/service-worker.js`:

| Request | Strategy | Why |
|---|---|---|
| `*.mvt`, `*.pbf` (tiles, glyphs) | cache-first, no revalidation | Immutable per URL. Re-checking thousands of them costs 4G data for nothing. |
| `style.json`, `tiles.json`, sprite | stale-while-revalidate | Small, and they do change when Carto update the style. |
| Web fonts | stale-while-revalidate | Same persistent cache — they were being wiped by the same purge. |

The cache is bounded at 4000 entries, trimmed oldest-first, checked
every 50th write rather than every write.

## What still doesn't work offline

**A whole-country basemap.** If you've never had signal in an area and
never saved it, there is nothing to draw. That's inherent — the tiles
have to come from somewhere.

The real fix for that is a self-hosted [PMTiles](https://protomaps.com)
extract of the UK served off the Pi: one ~1–2 GB file, no CDN, no
per-area saving. It's a bigger piece of work (a build/download step, an
nginx location with range requests, a style swap) and it wants a hard
look at SD-card space first. Worth doing; not done here.

Note also that a **coverage overlay** — painting predicted signal across
the map — is *not* on the table from Ofcom's data: they publish
per-postcode lookups and local-authority aggregates, not a tile layer,
and a heatmap built from postcode calls would blow the 50k/28-day quota.
The measured alternative (logging the van's own modem signal against the
GPS breadcrumb) is in `signal-coverage-design.md`.

## Tests

```
npm run test:maps
```

Plain node assertions, no test runner, no new dependencies:

- `tests/tile-math.test.mjs` — Web Mercator tile arithmetic against
  independently-computed references, budget ceilings, and the clamping
  that stops `±85.0511°` producing tile index −1 (found by this test,
  which is the only reason it isn't still in there).
- `tests/service-worker.test.mjs` — loads the real worker in a VM and
  checks the routing predicates and, above all, that `activate()` keeps
  the map cache.

The end-to-end proof is separate because it needs a browser:

```
npm i -D playwright && npx playwright install chromium
npm run build && cp -r dist /tmp/vanos-A
npm run build && cp -r dist /tmp/vanos-B     # different build id = a deploy
cp -r /tmp/vanos-A /tmp/vanos-live
node tests/deploy-cache-survival.playwright.mjs
```

It drives a real Chromium through a real deploy and asserts the saved
tile is still readable afterwards. It has been confirmed to **fail**
against the pre-fix worker — restore `k !== VERSION` in `activate()` if
you want to watch it catch the bug. A test that has never failed hasn't
told you anything.
