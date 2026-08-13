/* Tile maths behind "Save this area" (src/lib/mapStyle.ts).
   Run via scripts/test-offline-maps.sh, which compiles the module to a
   temp dir first - there's no bundler in this path on purpose, so the
   test exercises the real arithmetic and nothing else. */
import assert from 'node:assert/strict';
import { lonToTileX, latToTileY, tilesForBBox, planTiles, DEFAULT_TILE_BUDGET } from './mapStyle.js';

// Known-good Web Mercator reference points (OSM slippy map spec).
assert.equal(lonToTileX(-180, 0), 0, 'world origin x');
assert.equal(latToTileY(85.0511, 0), 0, 'world origin y');
assert.equal(lonToTileX(0, 1), 1, 'greenwich sits in the right half at z1');
assert.equal(latToTileY(0, 1), 1, 'equator sits in the bottom half at z1');

// Wasdale Head, roughly. z12 tile per the standard formula.
const lon = -3.2947;
const lat = 54.4675;
assert.equal(lonToTileX(lon, 12), Math.floor(((lon + 180) / 360) * 2 ** 12));
// Reference computed independently from the slippy-map formula.
assert.equal(lonToTileX(lon, 12), 2010, 'wasdale x at z12');
assert.equal(latToTileY(lat, 12), 1306, 'wasdale y at z12');

// Latitude beyond the Mercator limit must clamp, not produce NaN/negatives.
for (const bad of [90, -90, 89.9, -95]) {
  const y = latToTileY(bad, 5);
  assert.ok(Number.isInteger(y) && y >= 0 && y < 2 ** 5, `clamped y for lat ${bad}: got ${y}`);
}

// A small bbox at a low zoom is a single tile; tile counts grow 4x per level.
const bbox = { west: -3.35, south: 54.43, east: -3.25, north: 54.5 };
assert.equal(tilesForBBox(bbox, 4).length, 1);
const at10 = tilesForBBox(bbox, 10).length;
const at11 = tilesForBBox(bbox, 11).length;
assert.ok(at11 >= at10 * 2, `z11 (${at11}) should dwarf z10 (${at10})`);

// planTiles: three zoom levels by default, never over budget.
const plan = planTiles(bbox, 11);
const zooms = [...new Set(plan.map((t) => t.z))].sort();
assert.deepEqual(zooms, [11, 12, 13], 'base zoom plus two');
assert.ok(plan.length <= DEFAULT_TILE_BUDGET, 'within budget');

// Budget is a hard ceiling even for a whole-country view.
const uk = { west: -8.6, south: 49.9, east: 1.8, north: 60.9 };
const big = planTiles(uk, 9);
assert.ok(big.length <= DEFAULT_TILE_BUDGET, `whole-UK plan stayed in budget: ${big.length}`);
assert.ok(big.length > 0, 'and still saved something');

// Never plans past the source's max zoom.
const capped = planTiles(bbox, 13, { maxZoom: 14 });
assert.ok(Math.max(...capped.map((t) => t.z)) <= 14, 'respects source maxzoom');

// A view already at max zoom still yields that one level.
const atMax = planTiles(bbox, 14, { maxZoom: 14 });
assert.deepEqual([...new Set(atMax.map((t) => t.z))], [14]);

// Antimeridian / out-of-range longitudes can't produce negative indices.
const wrapped = tilesForBBox({ west: 179.5, south: 0, east: -179.5, north: 1 }, 6);
assert.ok(
  wrapped.every((t) => t.x >= 0 && t.x < 2 ** 6 && t.y >= 0 && t.y < 2 ** 6),
  'wrapped bbox stays in range',
);

console.log('tile math: all assertions passed');
