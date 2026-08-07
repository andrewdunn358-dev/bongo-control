/* Loads the real service-worker.js in a VM with a stub `self` and
   exercises its routing predicates directly. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs
  .readFileSync(path.join(here, '..', 'public', 'service-worker.js'), 'utf8')
  .replace(/__BUILD_ID__/g, 'testbuild');

const listeners = {};
const context = {
  self: {
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
    location: { origin: 'http://van.local' },
    clients: { claim: async () => {} },
    skipWaiting: () => {},
  },
  caches: { open: async () => ({}), keys: async () => [], delete: async () => true },
  fetch: async () => ({ ok: true, clone: () => ({}) }),
  URL,
  Response: { error: () => ({}) },
  console,
};
vm.createContext(context);
vm.runInContext(src, context);

const run = (expr) => vm.runInContext(expr, context);

// The two cache names must be distinct, and only the map one is stable
// across builds.
assert.equal(run('MAP_CACHE'), 'bongo-maps-v1', 'map cache name is not build-stamped');
assert.ok(run('VERSION').includes('testbuild'), 'shell cache IS build-stamped');
assert.equal(JSON.stringify(run("KEEP_CACHES")), JSON.stringify([run("VERSION"), "bongo-maps-v1"]));

// The bug this fixes: activate() must keep the map cache.
const purge = (keys) => keys.filter((k) => !run('KEEP_CACHES').includes(k));
assert.deepEqual(
  purge(['bongo-shell-oldbuild', 'bongo-shell-testbuild', 'bongo-maps-v1']),
  ['bongo-shell-oldbuild'],
  'only the stale shell cache is purged',
);

// Map asset routing.
const isMap = (u) => run(`isMapAsset(new URL(${JSON.stringify(u)}))`);
const isImmutable = (u) => run(`isImmutableMapAsset(new URL(${JSON.stringify(u)}))`);

for (const u of [
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  'https://tiles.basemaps.cartocdn.com/fonts/Open%20Sans%20Regular/0-255.pbf',
  'https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/12/2010/1306.mvt',
  'https://a.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json',
]) {
  assert.ok(isMap(u), `map asset: ${u}`);
}

// Must not swallow lookalike hosts - a suffix check without the dot
// would match "evilcartocdn.com".
for (const u of ['https://evilcartocdn.com/x.mvt', 'https://van.local/api/health', 'https://example.com/a.pbf']) {
  assert.ok(!isMap(u), `not a map asset: ${u}`);
}

// Immutable (cache-first, no revalidation) vs manifests (revalidate).
assert.ok(isImmutable('https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/12/2010/1306.mvt'));
assert.ok(isImmutable('https://tiles.basemaps.cartocdn.com/fonts/Open%20Sans%20Regular/0-255.pbf'));
assert.ok(!isImmutable('https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'));
assert.ok(!isImmutable('https://a.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json'));

console.log('service worker units: all assertions passed');
