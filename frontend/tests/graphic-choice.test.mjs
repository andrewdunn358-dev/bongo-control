/**
 * THE GRAPHICS LAYER: theme graphic -> theme asset -> built-in.
 *
 * Every case runs the real chain end to end - themeAssetResolve (is
 * there a packaged image?), chooseGraphic (which source wins?) and
 * GraphicSlot (what is actually drawn?) - and checks the rendered
 * markup, not a return value.
 *
 * Telling drawings apart: the animated built-ins carry the class
 * `vw-illustrated`; the standard drawings do not; a packaged image is an
 * <img>.
 *
 * Run: node tests/graphic-choice.test.mjs
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const bundled = await build({
  stdin: {
    contents: `
      export { chooseGraphic } from '@/layout/graphicChoice';
      export { resolveThemeAsset } from '@/lib/themeAssetResolve';
      export { GraphicSlot } from '@/components/widgets/graphics/GraphicSlot';
      export {
        BATTERY_GRAPHICS, SOLAR_GRAPHICS, WEATHER_GRAPHICS, POWER_FLOW_GRAPHICS,
        DEFAULT_VARIANTS, VARIANT_TABLES,
      } from '@/components/widgets/graphics/registry';
      export { powerFlowDirection, BALANCED_WITHIN_W } from '@/components/widgets/graphics/derive';
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
  external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime'],
});

// Written beside node_modules so the bare React imports resolve.
const tmp = join(root, 'tests', '.graphic-choice.bundle.mjs');
writeFileSync(tmp, bundled.outputFiles[0].text);
let m;
try {
  m = await import(tmp);
} finally {
  rmSync(tmp, { force: true });
}

let passed = 0;
function ok(name) {
  console.log(`  ok  ${name}`);
  passed += 1;
}

const urlFor = (id, path) => `/api/themes/${id}/assets/${path}`;
const statusFor = (map) => (url) => map[url] ?? 'unknown';
/** A slot comfortably big enough for every illustrated drawing. */
const ROOMY = { width: 400, height: 300 };

/** The four graphic widgets, with the data props their widget supplies. */
const WIDGETS = [
  ['battery', m.BATTERY_GRAPHICS, 'battery', { soc: 64, charging: true, size: 118, voltage: 13.1 }],
  ['solar', m.SOLAR_GRAPHICS, 'solar', { active: true, size: 74, watts: 120, chargeState: 'bulk' }],
  ['weather', m.WEATHER_GRAPHICS, 'weather', { condition: 'Light rain', size: 42, tempC: 11 }],
  ['power-flow', m.POWER_FLOW_GRAPHICS, 'power', { solarWatts: 120, loadWatts: 45, netWatts: 75, direction: 'charging' }],
];

/** Runs the whole chain for one widget and returns the markup. */
function drawn({ theme, role, table, artClass, props, statuses = {}, themeVariant, box = ROOMY, state = 'full' }) {
  const asset = m.resolveThemeAsset(theme, role, urlFor, statusFor(statuses));
  const choice = m.chooseGraphic({
    themeVariant,
    asset,
    defaultVariant: m.DEFAULT_VARIANTS[role],
    table: m.VARIANT_TABLES[role],
    state,
    box,
  });
  const html = m.renderToStaticMarkup(
    m.createElement(m.GraphicSlot, { table, choice, artClass, props }),
  );
  return { html, choice };
}

const isAnimated = (h) => h.includes('vw-illustrated') && !h.includes('<img');
const isStandard = (h) => h.includes('<svg') && !h.includes('vw-illustrated') && !h.includes('<img');
const isImage = (h) => h.includes('<img') && !h.includes('<svg');

// ---------------------------------------------------------------------
// 1. A THEME WITH NO WIDGET ASSETS -> built-in animated graphics render.
//    Galloway-style: it has its own hero image but nothing for widgets.

const GALLOWAY = { serverId: 'galloway', assets: { hero: 'assets/hero.jpg' } };
for (const [role, table, artClass, props] of WIDGETS) {
  // Power flow's standard drawing is the widget's own inline markup, so
  // its graphic slot renders nothing for "standard" - check the choice.
  const { html, choice } = drawn({ theme: GALLOWAY, role, table, artClass, props });
  assert.equal(choice.source, 'built-in', `${role}: expected the built-in drawing, got ${choice.source}`);
  assert.equal(choice.variant, 'illustrated', `${role}: the default is not the animated drawing`);
  assert.ok(isAnimated(html), `${role}: the animated drawing did not render`);
  ok(`1. no widget assets -> animated built-in ${role}`);
}

// A colours-only theme (no assets at all, no presentation) and the
// built-in theme (no installed theme) behave the same way.
for (const theme of [{ serverId: 'freeda-bright' }, undefined]) {
  const [role, table, artClass, props] = WIDGETS[0];
  assert.ok(isAnimated(drawn({ theme, role, table, artClass, props }).html));
}
ok('1. colours-only and built-in themes -> animated built-ins too');

// ---------------------------------------------------------------------
// 2. A REAL STATIC BATTERY ASSET -> the packaged image is used.

const BRAND = { serverId: 'brand', assets: { battery: 'assets/battery.png' } };
const BRAND_URL = '/api/themes/brand/assets/assets/battery.png';
{
  const [role, table, artClass, props] = WIDGETS[0];
  const { html, choice } = drawn({ theme: BRAND, role, table, artClass, props, statuses: { [BRAND_URL]: 'present' } });
  assert.equal(choice.source, 'theme-asset');
  assert.ok(isImage(html), 'the packaged battery image was not used');
  assert.ok(html.includes(`src="${BRAND_URL}"`));
  assert.ok(html.includes('vw-theme-art-battery'), 'the packaged image lost its sizing class');
  // The card keeps the layout of the drawing the image stands in for.
  assert.equal(choice.variant, 'illustrated', 'an image choice did not carry its card layout');
  ok('2. real static battery asset -> packaged image used, in the animated card layout');

  // Other roles on the same theme are untouched.
  const [sRole, sTable, sClass, sProps] = WIDGETS[1];
  assert.ok(isAnimated(drawn({ theme: BRAND, role: sRole, table: sTable, artClass: sClass, props: sProps,
    statuses: { [BRAND_URL]: 'present' } }).html));
  ok('2. ...and roles it does not provide still get the animated built-in');
}

// ---------------------------------------------------------------------
// 3. A CUSTOM BATTERY GRAPHIC -> it is used, and beats a packaged image.
//
// "Custom" is any registered drawing the theme names. Registered here
// in a test table, exactly as a real one (a Royal Artillery battery,
// say) would be registered in the build.

function CustomBattery({ soc, voltage, shuntFitted }) {
  return `CUSTOM soc=${soc} v=${voltage} shunt=${shuntFitted}`;
}
const WITH_CUSTOM = {
  ...m.BATTERY_GRAPHICS,
  artillery: { minWidth: 100, minHeight: 80, states: ['full', 'compact'], component: CustomBattery },
};
{
  const choice = m.chooseGraphic({
    themeVariant: 'artillery',
    asset: BRAND_URL, // a real image exists too - the graphic must still win
    defaultVariant: 'illustrated',
    table: WITH_CUSTOM,
    state: 'full',
    box: ROOMY,
  });
  assert.equal(choice.source, 'theme-graphic');
  assert.equal(choice.variant, 'artillery');
  const html = m.renderToStaticMarkup(m.createElement(m.GraphicSlot, {
    table: WITH_CUSTOM, choice, artClass: 'battery',
    props: { soc: 64, charging: true, size: 118, voltage: 13.1, shuntFitted: true },
  }));
  assert.ok(html.includes('CUSTOM'), 'the custom graphic was not drawn');
  assert.ok(!html.includes('<img'), 'the packaged image was drawn instead of the custom graphic');
  // It receives the widget's real data, not a subset.
  assert.ok(html.includes('soc=64') && html.includes('v=13.1') && html.includes('shunt=true'),
    `the custom graphic did not receive the battery data: ${html}`);
  ok('3. custom battery graphic -> used, beats a packaged image, receives the real data');
}
// Naming "standard" is an explicit choice of the plain drawing.
{
  const [role, table, artClass, props] = WIDGETS[0];
  const { html, choice } = drawn({ theme: BRAND, role, table, artClass, props,
    statuses: { [BRAND_URL]: 'present' }, themeVariant: 'standard' });
  assert.equal(choice.source, 'theme-graphic');
  assert.ok(isStandard(html), 'an explicit "standard" did not give the plain drawing');
  ok('3. a theme naming "standard" gets the plain drawing, even with an image available');
}
// A custom graphic too big for its slot gives way to the next source.
{
  const choice = m.chooseGraphic({
    themeVariant: 'artillery', asset: BRAND_URL, defaultVariant: 'illustrated',
    table: WITH_CUSTOM, state: 'full', box: { width: 60, height: 40 },
  });
  assert.equal(choice.source, 'theme-asset', 'an unfittable custom graphic did not give way');
  assert.equal(choice.variant, 'standard', 'the card layout ignored the small slot');
  ok('3. a custom graphic that does not fit gives way to the image, in a card that fits');
}

// ---------------------------------------------------------------------
// 4. A DECLARED PATH THAT DOES NOT EXIST -> no broken <img>; built-in.

{
  const [role, table, artClass, props] = WIDGETS[0];
  for (const status of ['missing', 'unknown']) {
    const { html, choice } = drawn({ theme: BRAND, role, table, artClass, props,
      statuses: { [BRAND_URL]: status } });
    assert.equal(choice.source, 'built-in', `declared but ${status}: did not fall back`);
    assert.ok(!html.includes('<img'), `declared but ${status}: rendered an <img>`);
    assert.ok(isAnimated(html), `declared but ${status}: the animated built-in did not render`);
  }
  ok('4. declared but missing (or unconfirmed) -> no <img>, animated built-in instead');
}

// ---------------------------------------------------------------------
// 5. EXISTING THEMES CONTINUE TO RENDER.

// The envelopes still protect small slots: a slot too small for the
// animated drawing gets the standard one, not a squeezed animation.
{
  const [role, table, artClass, props] = WIDGETS[0];
  const { html, choice } = drawn({ theme: undefined, role, table, artClass, props, box: { width: 120, height: 80 } });
  assert.equal(choice.variant, 'standard');
  assert.equal(choice.reason, 'too-narrow');
  assert.ok(isStandard(html), 'a too-small slot did not get the standard drawing');
  ok('5. slot too small for the animation -> standard drawing, not a squeezed one');
}
// A state the animated drawing does not implement gets the standard one.
{
  const [role, table, artClass, props] = WIDGETS[0];
  const { html } = drawn({ theme: undefined, role, table, artClass, props, state: 'minimal' });
  assert.ok(isStandard(html), 'minimal state did not fall back to the standard drawing');
  ok('5. a state the animation does not draw -> standard drawing');
}
// Before the slot is measured, the standard drawing holds the place -
// and a theme's own route is kept, so its image never flashes first.
{
  const choice = m.chooseGraphic({ themeVariant: 'illustrated', asset: BRAND_URL, defaultVariant: 'illustrated',
    table: m.VARIANT_TABLES.battery, state: 'full', box: null });
  assert.equal(choice.source, 'theme-graphic');
  assert.equal(choice.variant, 'standard');
  ok('5. unmeasured slot -> placeholder drawing, no flash of a packaged image');
}
// A theme that explicitly asks for the animated drawing gets it, even
// with an image available - its choice is a graphic.
{
  const [role, table, artClass, props] = WIDGETS[0];
  const { choice, html } = drawn({ theme: BRAND, role, table, artClass, props,
    statuses: { [BRAND_URL]: 'present' }, themeVariant: 'illustrated' });
  assert.equal(choice.source, 'theme-graphic');
  assert.ok(isAnimated(html));
  ok('5. a theme choosing "illustrated" gets the animation, whatever images it ships');
}

// ---------------------------------------------------------------------
// 6. #52 CANNOT REGRESS: an undeclared role never produces an image,
//    even if a conventionally-named file were sitting in the package.

{
  const everythingPresent = () => 'present';
  for (const [role, table, artClass, props] of WIDGETS) {
    const asset = m.resolveThemeAsset(GALLOWAY, role, urlFor, everythingPresent);
    assert.equal(asset, undefined, `${role}: an undeclared role produced an image`);
    const choice = m.chooseGraphic({ asset, defaultVariant: m.DEFAULT_VARIANTS[role],
      table: m.VARIANT_TABLES[role], state: 'full', box: ROOMY });
    const html = m.renderToStaticMarkup(m.createElement(m.GraphicSlot, { table, choice, artClass, props }));
    assert.ok(isAnimated(html), `${role}: #52 regressed - the animation was suppressed`);
  }
  ok('6. #52: no guessed image can suppress an animated graphic');
}

// ---------------------------------------------------------------------
// POWER-FLOW DIRECTION, derived from the net balance the van publishes.

assert.equal(m.powerFlowDirection(75), 'charging');
assert.equal(m.powerFlowDirection(-40), 'discharging');
assert.equal(m.powerFlowDirection(m.BALANCED_WITHIN_W - 1), 'balanced');
assert.equal(m.powerFlowDirection(-(m.BALANCED_WITHIN_W - 1)), 'balanced');
assert.equal(m.powerFlowDirection(null), 'unknown', 'no reading was guessed as balanced');
assert.equal(m.powerFlowDirection(undefined), 'unknown');
assert.equal(m.powerFlowDirection(Number.NaN), 'unknown');
ok('power-flow direction: charging / discharging / balanced, and unknown is never guessed');

console.log(`\n${passed} checks passed`);
