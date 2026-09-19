/**
 * THEME ASSETS - a packaged image is used only when it is declared AND exists.
 *
 * Regression for #52. Asset lookup fell back to a conventional filename
 * (battery -> assets/battery.jpg) whenever a role was undeclared, and
 * returned that URL without knowing whether the file was in the package.
 * The illustrated graphics draw a packaged image INSTEAD of themselves
 * whenever they are handed one - so on every installed theme, Galloway
 * included, the new illustrated SVGs never drew.
 *
 * These tests run the real resolver and render the real illustrated
 * components, so "SVG or <img>" is checked on actual markup rather than
 * inferred from a return value.
 *
 * Run: node tests/theme-assets.test.mjs
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { strict as assert } from 'node:assert';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const bundled = await build({
  stdin: {
    contents: `
      export * from '@/lib/themeAssetResolve';
      export {
        IllustratedBattery, IllustratedSolar, IllustratedWeather, IllustratedPowerFlow,
      } from '@/components/widgets/graphics/illustrated';
      export { createElement } from 'react';
      export { renderToStaticMarkup } from 'react-dom/server';
    `,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  alias: { '@': join(root, 'src') },
  // React ships CommonJS; resolve it from node_modules at run time
  // rather than bundling it into a data: URL module.
  external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime'],
});

// A data: URL cannot resolve bare imports, so the bundle is written next
// to node_modules for the length of the run.
const { writeFileSync, rmSync } = await import('node:fs');
const tmp = join(root, 'tests', '.theme-assets.bundle.mjs');
writeFileSync(tmp, bundled.outputFiles[0].text);
let mod;
try {
  mod = await import(tmp);
} finally {
  rmSync(tmp, { force: true });
}
const {
  declaredAssetPath, resolveThemeAsset, createAssetProbe, probeDeclaredAssets,
  IllustratedBattery, IllustratedSolar, IllustratedWeather, IllustratedPowerFlow,
  createElement, renderToStaticMarkup,
} = mod;

let passed = 0;
function ok(name) {
  console.log(`  ok  ${name}`);
  passed += 1;
}

const urlFor = (id, path) => `/api/themes/${id}/assets/${path}`;
const render = (Comp, props) => renderToStaticMarkup(createElement(Comp, props));

/** The four widget roles #50 built illustrated graphics for. */
const GRAPHICS = [
  ['battery', IllustratedBattery, { soc: 64, charging: true, size: 118 }],
  ['solar', IllustratedSolar, { size: 74, active: true }],
  ['weather', IllustratedWeather, { condition: 'Partly cloudy', size: 42 }],
  ['power-flow', IllustratedPowerFlow, { solarWatts: 120, loadWatts: 45, netWatts: 75 }],
];

// ---------------------------------------------------------------------
// 1. GALLOWAY: an installed theme with its own hero imagery but NO
//    widget imagery. Every widget must draw its built-in illustrated SVG.

const GALLOWAY = { serverId: 'galloway', assets: { hero: 'assets/hero.jpg' } };

// Report EVERY url as present. That is the strongest version of the
// test: even if a conventionally-named file were sitting in the package,
// an undeclared role still must not use it.
const everythingPresent = () => 'present';

for (const [role, Comp, props] of GRAPHICS) {
  assert.equal(declaredAssetPath(GALLOWAY, role), undefined, `${role}: an undeclared role produced a path`);
  const asset = resolveThemeAsset(GALLOWAY, role, urlFor, everythingPresent);
  assert.equal(asset, undefined, `${role}: an undeclared role resolved to ${asset}`);

  const html = render(Comp, { ...props, asset });
  assert.ok(html.includes('<svg'), `${role}: the built-in illustrated SVG did not render`);
  assert.ok(!html.includes('<img'), `${role}: rendered an <img> instead of the illustrated SVG`);
  ok(`Galloway, no ${role} imagery -> built-in illustrated SVG renders`);
}

// ...and nothing is ever REQUESTED for a guessed path. Only the declared
// hero is checked.
const requested = [];
probeDeclaredAssets(GALLOWAY, urlFor, { request: (u) => requested.push(u) });
assert.deepEqual(requested, ['/api/themes/galloway/assets/assets/hero.jpg'],
  `requests were made for undeclared assets: ${JSON.stringify(requested)}`);
for (const guess of ['battery.jpg', 'solar.jpg', 'weather.jpg', 'power-flow.jpg', 'heater.jpg', 'roof.jpg', 'switches.jpg']) {
  assert.ok(!requested.some((u) => u.endsWith(guess)), `a request was made for the conventional ${guess}`);
}
ok('Galloway: only the declared hero is requested - no conventional JPG is ever fetched');

// The hero it DOES declare still resolves once confirmed - its own
// imagery is preserved.
assert.equal(
  resolveThemeAsset(GALLOWAY, 'hero', urlFor, everythingPresent),
  '/api/themes/galloway/assets/assets/hero.jpg',
);
ok('Galloway: its declared hero imagery is still used');

// ---------------------------------------------------------------------
// 2. THE OPPOSITE CASE: battery.jpg explicitly provided.

const WITH_BATTERY = { serverId: 'brand', assets: { battery: 'assets/battery.jpg' } };
const BATTERY_URL = '/api/themes/brand/assets/assets/battery.jpg';
const statusFor = (map) => (url) => map[url] ?? 'unknown';

{
  const asset = resolveThemeAsset(WITH_BATTERY, 'battery', urlFor, statusFor({ [BATTERY_URL]: 'present' }));
  assert.equal(asset, BATTERY_URL);
  const html = render(IllustratedBattery, { soc: 64, charging: false, size: 118, asset });
  assert.ok(html.includes('<img'), 'a declared, present battery.jpg was not used');
  assert.ok(html.includes(`src="${BATTERY_URL}"`), 'the packaged image was not the declared one');
  assert.ok(!html.includes('<svg'), 'the SVG drew as well as the packaged image');
  ok('theme provides battery.jpg -> the packaged image is used');
}

// 3. battery.jpg NOT provided -> built-in SVG. (Same theme, other role.)
{
  const asset = resolveThemeAsset(WITH_BATTERY, 'solar', urlFor, statusFor({ [BATTERY_URL]: 'present' }));
  assert.equal(asset, undefined);
  const html = render(IllustratedSolar, { size: 74, active: true, asset });
  assert.ok(html.includes('<svg') && !html.includes('<img'), 'an unprovided role did not fall through to the SVG');
  ok('theme does not provide solar.jpg -> built-in SVG is used');
}

// 4. DECLARED BUT NOT IN THE PACKAGE. The Pi does not check that paths
//    in "assets" exist, so declaration alone is not proof.
{
  const asset = resolveThemeAsset(WITH_BATTERY, 'battery', urlFor, statusFor({ [BATTERY_URL]: 'missing' }));
  assert.equal(asset, undefined, 'a declared asset that 404s was still used');
  const html = render(IllustratedBattery, { soc: 64, size: 118, asset });
  assert.ok(html.includes('<svg') && !html.includes('<img'));
  ok('declared but missing -> built-in SVG, not a broken image');
}

// 5. DECLARED, NOT YET CONFIRMED. Treated as absent until the check
//    returns, so a possibly-missing file is never shown as a broken image.
assert.equal(resolveThemeAsset(WITH_BATTERY, 'battery', urlFor, statusFor({})), undefined);
ok('declared but not yet confirmed -> built-in drawing until confirmed');

// 6. Not an installed theme at all.
assert.equal(resolveThemeAsset(undefined, 'battery', urlFor, everythingPresent), undefined);
assert.equal(resolveThemeAsset({ assets: { battery: 'x.jpg' } }, 'battery', urlFor, everythingPresent), undefined);
ok('no installed theme -> no packaged asset');

// Degenerate declarations are not paths.
assert.equal(declaredAssetPath({ assets: { battery: '' } }, 'battery'), undefined);
assert.equal(declaredAssetPath({ assets: { battery: '   ' } }, 'battery'), undefined);
assert.equal(declaredAssetPath({ assets: { battery: 42 } }, 'battery'), undefined);
ok('empty or non-string declarations are not treated as paths');

// ---------------------------------------------------------------------
// 7. THE EXISTENCE CHECK ITSELF.

{
  const loads = [];
  let settle;
  const probe = createAssetProbe((url) => {
    loads.push(url);
    return new Promise((r) => { settle = r; });
  });
  let heard = 0;
  probe.subscribe(() => { heard += 1; });

  assert.equal(probe.status('a.jpg'), 'unknown');
  probe.request('a.jpg');
  probe.request('a.jpg');
  assert.equal(loads.length, 1, 'the same asset was fetched twice while in flight');
  settle(true);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(probe.status('a.jpg'), 'present');
  assert.equal(heard, 1, 'subscribers were not told the answer arrived');
  probe.request('a.jpg');
  assert.equal(loads.length, 1, 'an answered asset was fetched again');
  ok('probe: fetched once, reports present, notifies, never refetches');
}
{
  const probe = createAssetProbe(async () => false);
  probe.request('gone.jpg');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(probe.status('gone.jpg'), 'missing');
  ok('probe: a failed load is recorded as missing');
}
{
  const probe = createAssetProbe(() => Promise.reject(new Error('offline')));
  probe.request('err.jpg');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(probe.status('err.jpg'), 'missing', 'a loader that throws left the asset unresolved');
  ok('probe: a loader error is recorded as missing, not left pending');
}

console.log(`\n${passed} checks passed`);
