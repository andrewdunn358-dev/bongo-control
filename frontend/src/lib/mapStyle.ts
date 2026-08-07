/**
 * Shared map configuration + offline tile saving.
 *
 * WHY THIS EXISTS
 * The van's whole point is being somewhere without signal, and until now
 * every map in the app was a black rectangle the moment it lost
 * internet. Two separate things caused that:
 *
 *   1. The service worker cached tiles into a cache named after the
 *      build id, and purged every other cache on activate - so each
 *      deploy silently threw away every tile ever downloaded. Fixed in
 *      public/service-worker.js (see MAP_CACHE there).
 *   2. Nothing ever fetched tiles for anywhere you hadn't already
 *      panned over while online. Caching only helps for pixels you
 *      happened to look at. `prefetchArea` below fixes that: you press
 *      a button while you have signal and it pulls the current view -
 *      and a couple of zoom levels in - into the same persistent cache.
 *
 * This is deliberately NOT a full offline basemap. Ofcom-style honesty
 * applies here too: what you save is what you asked for, and the UI says
 * so. A whole-UK offline basemap is a ~1-2 GB PMTiles file and a
 * different piece of work (see the design doc).
 */

import type maplibregl from 'maplibre-gl';

/** One place for the style URL - it was duplicated across screens. */
export const MAP_STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

/** Hard ceiling on one "save this area" press.
 *
 * Not arbitrary: this is a metered 4G SIM, and tile counts explode by
 * 4x per zoom level. ~1200 vector tiles is roughly 30-60 MB, which is a
 * reasonable thing to spend on a valley you're about to drive into. The
 * UI shows the count before it starts. */
export const DEFAULT_TILE_BUDGET = 1200;

/** How many zoom levels past the current view to save. Two gets you
 *  from "the valley" to "which track is which" without a 16x blow-up. */
export const DEFAULT_EXTRA_ZOOM = 2;

/** Fetch this many tiles at once. The Pi isn't in this path (the tablet
 *  talks to the CDN directly), but a phone on one bar does not benefit
 *  from 50 parallel requests. */
const CONCURRENCY = 6;

export interface TileSource {
  tiles: string[];
  minzoom: number;
  maxzoom: number;
}

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

export interface PrefetchProgress {
  /** Tiles fetched so far (whether from network or already cached). */
  done: number;
  /** Total this run will attempt. Known up front. */
  total: number;
  /** Requests that failed - almost always "signal died mid-save". */
  failed: number;
}

/** Web Mercator clamp. Beyond this latitude the projection is undefined,
 *  and a bad y index is a 404 per tile rather than an obvious error. */
const MAX_LAT = 85.0511287798066;

/** Clamp a tile index into the world at this zoom.
 *
 * Not belt-and-braces: at exactly ±MAX_LAT the projection maths lands a
 * hair either side of the world edge in floating point, and Math.floor
 * turns "-0.0000001" into tile -1. That's a guaranteed 404 for every
 * tile in the row, which would look like a patchy map rather than an
 * off-by-one. */
function clampIndex(value: number, z: number): number {
  const n = 2 ** z;
  return Math.min(n - 1, Math.max(0, value));
}

export function lonToTileX(lon: number, z: number): number {
  const n = 2 ** z;
  return clampIndex(Math.floor(((lon + 180) / 360) * n), z);
}

export function latToTileY(lat: number, z: number): number {
  const clamped = Math.min(MAX_LAT, Math.max(-MAX_LAT, lat));
  const rad = (clamped * Math.PI) / 180;
  const n = 2 ** z;
  return clampIndex(Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n), z);
}

export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Every tile covering a bbox at one zoom. Clamped to the world so a
 *  map dragged past the antimeridian can't ask for negative indices. */
export function tilesForBBox(bbox: BBox, z: number): TileCoord[] {
  const n = 2 ** z;
  const clamp = (v: number) => Math.min(n - 1, Math.max(0, v));
  const x0 = clamp(lonToTileX(bbox.west, z));
  const x1 = clamp(lonToTileX(bbox.east, z));
  // y is inverted: north edge gives the SMALLER index.
  const y0 = clamp(latToTileY(bbox.north, z));
  const y1 = clamp(latToTileY(bbox.south, z));

  const out: TileCoord[] = [];
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x += 1) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y += 1) {
      out.push({ z, x, y });
    }
  }
  return out;
}

/**
 * Build the tile list for a save, cheapest zoom first.
 *
 * Zooms are added coarsest-first and the whole level is dropped if it
 * won't fit in the budget - a half-saved zoom level is worse than none,
 * because it looks like the map has holes in it rather than simply
 * being less detailed than you hoped.
 */
export function planTiles(bbox: BBox, baseZoom: number, opts: { extraZoom?: number; budget?: number; maxZoom?: number } = {}): TileCoord[] {
  const extra = opts.extraZoom ?? DEFAULT_EXTRA_ZOOM;
  const budget = opts.budget ?? DEFAULT_TILE_BUDGET;
  const hardMax = opts.maxZoom ?? 14;

  const start = Math.max(0, Math.min(hardMax, Math.floor(baseZoom)));
  const planned: TileCoord[] = [];
  for (let z = start; z <= Math.min(hardMax, start + extra); z += 1) {
    const level = tilesForBBox(bbox, z);
    if (planned.length + level.length > budget) break;
    planned.push(...level);
  }
  // If even the base zoom blew the budget, save what fits of it rather
  // than returning nothing at all.
  if (planned.length === 0) return tilesForBBox(bbox, start).slice(0, budget);
  return planned;
}

function fillTemplate(template: string, tile: TileCoord): string {
  return template
    .replace('{z}', String(tile.z))
    .replace('{x}', String(tile.x))
    .replace('{y}', String(tile.y))
    // Subdomain rotation ({s} / {a-c}) isn't used by the Carto vector
    // style, but a template that has one must still resolve.
    .replace(/\{s\}/g, 'a');
}

/**
 * The tile URL templates the loaded style is actually using.
 *
 * Read from the style rather than hardcoded, so swapping the basemap
 * later doesn't silently leave the prefetcher saving the wrong tiles.
 * Sources given as a TileJSON `url` are resolved by fetching it - which
 * also lands that manifest in the offline cache, where it's needed.
 */
export async function tileSourcesFor(map: maplibregl.Map): Promise<TileSource[]> {
  let style: ReturnType<maplibregl.Map['getStyle']>;
  try {
    style = map.getStyle();
  } catch {
    return [];
  }
  const sources = style?.sources ?? {};
  const out: TileSource[] = [];

  for (const source of Object.values(sources)) {
    if (!source || (source.type !== 'vector' && source.type !== 'raster')) continue;
    const spec = source as { tiles?: string[]; url?: string; minzoom?: number; maxzoom?: number };

    if (Array.isArray(spec.tiles) && spec.tiles.length > 0) {
      out.push({ tiles: spec.tiles, minzoom: spec.minzoom ?? 0, maxzoom: spec.maxzoom ?? 14 });
      continue;
    }
    if (!spec.url) continue;
    try {
      const res = await fetch(spec.url);
      if (!res.ok) continue;
      const tilejson = (await res.json()) as { tiles?: string[]; minzoom?: number; maxzoom?: number };
      if (Array.isArray(tilejson.tiles) && tilejson.tiles.length > 0) {
        out.push({ tiles: tilejson.tiles, minzoom: tilejson.minzoom ?? 0, maxzoom: tilejson.maxzoom ?? 14 });
      }
    } catch {
      // Offline, or the manifest isn't cached yet. Nothing to save from
      // this source - the caller reports the shortfall honestly.
    }
  }
  return out;
}

async function runPool<T>(items: T[], worker: (item: T) => Promise<void>, signal?: AbortSignal): Promise<void> {
  let index = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (index < items.length) {
      if (signal?.aborted) return;
      const item = items[index];
      index += 1;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

export interface PrefetchResult extends PrefetchProgress {
  aborted: boolean;
  /** No tile source could be resolved - almost always "already offline". */
  noSource: boolean;
}

/**
 * Pull the current view into the persistent map cache.
 *
 * There is no direct cache writing here on purpose: these are plain
 * fetches, and the service worker's map-cache rule stores them. One
 * caching policy, one place, no chance of the two disagreeing about
 * what's saved.
 */
export async function prefetchArea(
  map: maplibregl.Map,
  opts: { extraZoom?: number; budget?: number; signal?: AbortSignal; onProgress?: (p: PrefetchProgress) => void } = {},
): Promise<PrefetchResult> {
  const sources = await tileSourcesFor(map);
  if (sources.length === 0) {
    return { done: 0, total: 0, failed: 0, aborted: false, noSource: true };
  }

  const bounds = map.getBounds();
  const bbox: BBox = {
    west: bounds.getWest(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    north: bounds.getNorth(),
  };

  const styleMaxZoom = Math.max(...sources.map((s) => s.maxzoom));
  const tiles = planTiles(bbox, map.getZoom(), {
    extraZoom: opts.extraZoom,
    budget: opts.budget,
    maxZoom: styleMaxZoom,
  });

  // One URL per (tile x source), skipping zooms a source can't serve.
  const urls: string[] = [];
  for (const source of sources) {
    for (const tile of tiles) {
      if (tile.z < source.minzoom || tile.z > source.maxzoom) continue;
      urls.push(fillTemplate(source.tiles[0], tile));
    }
  }

  const progress: PrefetchProgress = { done: 0, total: urls.length, failed: 0 };
  opts.onProgress?.({ ...progress });

  await runPool(
    urls,
    async (url) => {
      try {
        const res = await fetch(url, { signal: opts.signal });
        if (!res.ok) progress.failed += 1;
      } catch {
        progress.failed += 1;
      }
      progress.done += 1;
      opts.onProgress?.({ ...progress });
    },
    opts.signal,
  );

  return { ...progress, aborted: Boolean(opts.signal?.aborted), noSource: false };
}

/** Ask the service worker how much map data is saved. Resolves to null
 *  when there's no worker (dev server, or a browser with SW disabled) -
 *  the caller shows nothing rather than a wrong zero. */
export function mapCacheEntries(timeoutMs = 2000): Promise<number | null> {
  const sw = navigator.serviceWorker?.controller;
  if (!sw) return Promise.resolve(null);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), timeoutMs);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(typeof event.data?.entries === 'number' ? event.data.entries : null);
    };
    sw.postMessage({ type: 'MAP_CACHE_STATS' }, [channel.port2]);
  });
}

/** Drop every saved tile. Offered in Settings for when the SD card - or
 *  the tablet - is getting tight. */
export function clearMapCache(timeoutMs = 5000): Promise<boolean> {
  const sw = navigator.serviceWorker?.controller;
  if (!sw) return Promise.resolve(false);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(false), timeoutMs);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(Boolean(event.data?.cleared));
    };
    sw.postMessage({ type: 'CLEAR_MAP_CACHE' }, [channel.port2]);
  });
}
