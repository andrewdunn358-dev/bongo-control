/**
 * STATE-DRIVEN ARTWORK: the right frame for the reading, and NOTHING
 * when the van doesn't have the reading.
 *
 * Run: node tests/artwork.test.mjs
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const bundled = await build({
  stdin: { contents: `export * from '@/lib/artwork';`, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node',
  alias: { '@': join(root, 'src') },
});
const tmp = join(root, 'tests', '.artwork.bundle.mjs');
writeFileSync(tmp, bundled.outputFiles[0].text);
let m;
try { m = await import(tmp); } finally { rmSync(tmp, { force: true }); }
const { batteryArtwork, solarArtwork, weatherArtwork, cleanArtwork, artworkPaths } = m;

let passed = 0;
const check = (name, fn) => { fn(); passed += 1; console.log(`  ok  ${name}`); };
/** Stands in for the Pi serving a packaged image. */
const resolve = (p) => (p.startsWith('assets/') ? `https://van/theme/${p}` : undefined);

const BATTERY = {
  levels: [
    { upTo: 20, image: 'assets/bat-20.png' },
    { upTo: 50, image: 'assets/bat-50.png' },
    { upTo: 80, image: 'assets/bat-80.png' },
    { image: 'assets/bat-full.png' },
  ],
  charging: 'assets/bat-charging.png',
};

check('battery picks the frame for the level', () => {
  const at = (soc) => batteryArtwork(BATTERY, { soc, charging: false }, resolve)?.src;
  assert.match(at(0), /bat-20/);
  assert.match(at(20), /bat-20/);
  assert.match(at(21), /bat-50/);
  assert.match(at(80), /bat-80/);
  assert.match(at(81), /bat-full/);
  assert.match(at(100), /bat-full/);
});

check('charging art wins while charging', () => {
  assert.match(batteryArtwork(BATTERY, { soc: 45, charging: true }, resolve).src, /bat-charging/);
  assert.match(batteryArtwork(BATTERY, { soc: 45, charging: false }, resolve).src, /bat-50/);
  // No charging frame supplied: the level frame still shows.
  const noCharge = { levels: BATTERY.levels };
  assert.match(batteryArtwork(noCharge, { soc: 45, charging: true }, resolve).src, /bat-50/);
});

check('NO state of charge shows no artwork at all', () => {
  for (const soc of [null, undefined, Number.NaN]) {
    assert.equal(batteryArtwork(BATTERY, { soc, charging: false }, resolve), null, String(soc));
    // Not even while charging: charging is known, the level is not.
    assert.equal(batteryArtwork(BATTERY, { soc, charging: true }, resolve), null);
  }
});

check('a fill pair is clipped to the real charge', () => {
  const art = { fill: { body: 'assets/body.png', fill: 'assets/fill.png', bottom: 0.9, top: 0.1 } };
  const r = batteryArtwork(art, { soc: 62, charging: false }, resolve);
  assert.equal(r.kind, 'fill');
  assert.equal(r.fraction, 0.62);
  assert.equal(r.bottom, 0.9);
  assert.equal(r.top, 0.1);
  assert.match(r.body, /body\.png/);
  // Defaults when the theme doesn't say where the lines are.
  const plain = batteryArtwork({ fill: { body: 'assets/body.png', fill: 'assets/fill.png' } }, { soc: 50, charging: false }, resolve);
  assert.equal(plain.bottom, 1);
  assert.equal(plain.top, 0);
  // Out-of-range readings are clamped, never drawn past the glass.
  assert.equal(batteryArtwork(art, { soc: 140, charging: false }, resolve).fraction, 1);
});

check('a missing image file means no artwork, not a broken picture', () => {
  const missing = { levels: [{ image: 'elsewhere/nope.png' }] };
  assert.equal(batteryArtwork(missing, { soc: 30, charging: false }, resolve), null);
  const halfFill = { fill: { body: 'assets/body.png', fill: 'elsewhere/nope.png' } };
  assert.equal(batteryArtwork(halfFill, { soc: 30, charging: false }, resolve), null);
});

check('solar picks a band by watts, and says nothing without a reading', () => {
  const art = { bands: [{ upTo: 5, image: 'assets/s-idle.png' }, { upTo: 60, image: 'assets/s-low.png' }, { image: 'assets/s-high.png' }] };
  assert.match(solarArtwork(art, { watts: 0 }, resolve).src, /s-idle/);
  assert.match(solarArtwork(art, { watts: 45 }, resolve).src, /s-low/);
  assert.match(solarArtwork(art, { watts: 400 }, resolve).src, /s-high/);
  assert.equal(solarArtwork(art, { watts: null }, resolve), null);
});

check('weather matches the condition, whatever the capitals', () => {
  const art = { conditions: { rain: 'assets/w-rain.png', clear: 'assets/w-clear.png' } };
  assert.match(weatherArtwork(art, { condition: 'Rain' }, resolve).src, /w-rain/);
  assert.match(weatherArtwork(art, { condition: ' clear ' }, resolve).src, /w-clear/);
  assert.equal(weatherArtwork(art, { condition: 'thunder' }, resolve), null);
  assert.equal(weatherArtwork(art, { condition: null }, resolve), null);
});

check('cleanArtwork keeps what VanOS can use and drops the rest', () => {
  const art = cleanArtwork({
    battery: { levels: [{ upTo: 80, image: 'assets/b80.png' }, { upTo: 20, image: 'assets/b20.png' }, { upTo: 5 }] },
    solar: { bands: 'not a list' },
    weather: { conditions: { RAIN: 'assets/r.png', bad: 42 } },
    roof: { positions: { open: 'assets/roof-open.png' } },   // no sensor: never honoured
    unknownWidget: { anything: 'assets/x.png' },
  });
  // Steps come back in ascending order, whatever order they were written.
  assert.deepEqual(art.battery.levels.map((s) => s.upTo), [20, 80]);
  assert.equal(art.solar, undefined);
  assert.deepEqual(art.weather.conditions, { rain: 'assets/r.png' });
  assert.equal('roof' in art, false, 'roof artwork must never be accepted');
  assert.equal('unknownWidget' in art, false);
  assert.equal(cleanArtwork({}), undefined);
  assert.equal(cleanArtwork(null), undefined);
});

check('artworkPaths lists every file the package must carry', () => {
  const art = cleanArtwork({
    battery: { levels: [{ upTo: 50, image: 'assets/a.png' }], charging: 'assets/c.png', fill: { body: 'assets/b.png', fill: 'assets/f.png' } },
    weather: { conditions: { rain: 'assets/r.png', drizzle: 'assets/r.png' } },
  });
  assert.deepEqual(artworkPaths(art).sort(), ['assets/a.png', 'assets/b.png', 'assets/c.png', 'assets/f.png', 'assets/r.png']);
  assert.deepEqual(artworkPaths(undefined), []);
});

console.log(`\n${passed} artwork checks passed`);
