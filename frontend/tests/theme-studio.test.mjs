/**
 * THE STUDIO'S OUTPUT MUST BE A PACKAGE THE PI ACCEPTS.
 *
 * Builds a package with the real Studio code, reads it back with the
 * real reader, and checks the rules the backend enforces. The
 * definitive check - running the Pi's own validate_package against this
 * zip - is in tests/theme-studio-backend.py, which CI runs next to this.
 *
 * Run: node tests/theme-studio.test.mjs
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const bundled = await build({
  stdin: {
    contents: `
      export * from '@/lib/themeStudio';
      export { readZip, createZip } from '@/lib/zip';
      export { WIDGET_IDS } from '@/components/widgets/registry';
      export { WIDGET_VARIANTS } from '@/components/widgets/graphics/registry';
    `,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic',
  // Styles are irrelevant here and esbuild has nowhere to put them.
  loader: { '.css': 'empty', '.png': 'empty', '.jpg': 'empty', '.mp4': 'empty', '.svg': 'empty' },
  alias: { '@': join(root, 'src') },
  // Vite's build-time values, which never reach a plain node run.
  define: { 'import.meta.env.DEV': 'false', 'import.meta.env.VITE_DEMO': '"false"', 'import.meta.env.PROD': 'true', 'import.meta.env.BASE_URL': '"/"' },
  // The widget registry drags the whole app in; only its ids and
  // variant names are needed here, so the heavy leaves stay external.
  external: ['react', 'react-dom', 'react/jsx-runtime', 'react-router-dom', 'lucide-react', '@tanstack/react-query', 'sonner', 'framer-motion', 'maplibre-gl', 'recharts'],
});
const tmp = join(root, 'tests', '.theme-studio.bundle.mjs');
writeFileSync(tmp, bundled.outputFiles[0].text);
let m;
try { m = await import(tmp); } finally { rmSync(tmp, { force: true }); }
const {
  emptyDraft, buildPackage, themeDefinition, validateDraft, draftFromPackage,
  hexToTriplet, tripletToHex, readZip, WIDGET_IDS, WIDGET_VARIANTS,
} = m;

let passed = 0;
const check = (name, fn) => { fn(); passed += 1; console.log(`  ok  ${name}`); };
const acheck = async (name, fn) => { await fn(); passed += 1; console.log(`  ok  ${name}`); };

/** A realistic draft: colours, hero copy, a layout, a drawing, an image. */
const PNG = new Uint8Array([
  0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00,0x00,0x00,0x0d,0x49,0x48,0x44,0x52,
  0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,0x08,0x06,0x00,0x00,0x00,0x1f,0x15,0xc4,
  0x89,0x00,0x00,0x00,0x0a,0x49,0x44,0x41,0x54,0x78,0x9c,0x63,0x00,0x01,0x00,0x00,
  0x05,0x00,0x01,0x0d,0x0a,0x2d,0xb4,0x00,0x00,0x00,0x00,0x49,0x45,0x4e,0x44,0xae,
  0x42,0x60,0x82,
]);
function sampleDraft() {
  const d = emptyDraft();
  d.name = "Frankie's Pod";
  d.author = 'Frankie';
  d.tokens = { ink: '244 249 255', surface: '10 10 12', 'aurora-base': 'linear-gradient(180deg, #05070a 0%, #12141a 100%)' };
  d.typography = { display: 'grotesk' };
  d.shape = { lg: '14px' };
  d.density = 'compact';
  d.hero = { eyebrow: "FRANKIE'S POD · VANOS", title: 'Pull up a sandbag.', subtitle: 'Veterans · Stories', quote: 'Start swinging that lamp!', quoteAuthor: '' };
  d.layout = { version: 1, items: [{ widget: 'hero', span: 12 }, { widget: 'battery', span: 3 }, { widget: 'solar', span: 3 }] };
  d.widgets = { battery: { variant: 'illustrated' } };
  d.images = [{ role: 'hero', path: 'assets/hero.png', bytes: PNG, contentType: 'image/png', url: '' }];
  return d;
}

check('colour conversion round-trips', () => {
  assert.equal(hexToTriplet('#0a141e'), '10 20 30');
  assert.equal(tripletToHex('10 20 30'), '#0a141e');
  assert.equal(tripletToHex(undefined), '#000000');
});

check('a realistic draft has nothing wrong with it', () => {
  assert.deepEqual(validateDraft(sampleDraft(), WIDGET_IDS, WIDGET_VARIANTS), []);
});

check('theme.json carries what the app reads', () => {
  const def = themeDefinition(sampleDraft());
  assert.equal(def.hero.title, 'Pull up a sandbag.');
  assert.equal(def.hero.quoteAuthor, '');       // blank stays blank
  assert.equal(def.assets.hero, 'assets/hero.png');
  assert.equal(def.widgets.battery.variant, 'illustrated');
  assert.equal(def.home.layout.items.length, 3);
  assert.equal(def.home.heroCamera, false);
  assert.equal(def.density, 'compact');
});

check('the checks catch what the Pi would refuse', () => {
  const bad = emptyDraft();
  const text = (d) => validateDraft(d, WIDGET_IDS, WIDGET_VARIANTS).map((p) => `${p.level}: ${p.text}`).join('\n');
  assert.match(text(bad), /at least one colour/);

  const badColour = sampleDraft(); badColour.tokens.ink = 'red';
  assert.match(text(badColour), /error: "ink" is not a value/);

  const badRadius = sampleDraft(); badRadius.shape.lg = '14 pixels';
  assert.match(text(badRadius), /error: Corner radius/);

  const badWidget = sampleDraft(); badWidget.layout.items.push({ widget: 'teleporter', span: 3 });
  assert.match(text(badWidget), /error: "teleporter" is not a widget/);

  const badVariant = sampleDraft(); badVariant.widgets.battery = { variant: 'holographic' };
  assert.match(text(badVariant), /error: "holographic" is not a drawing/);

  const tooMany = sampleDraft();
  tooMany.images = Array.from({ length: 61 }, (_, i) => ({ role: `r${i}`, path: `assets/r${i}.png`, bytes: PNG, contentType: 'image/png', url: '' }));
  assert.match(text(tooMany), /error: Too many images/);

  const huge = sampleDraft(); huge.images[0].bytes = new Uint8Array(5 * 1024 * 1024 + 1);
  assert.match(text(huge), /error: .*5MB limit/);
});

check('the Galloway trap is a warning, not a silent loss', () => {
  // An image AND a drawing for the same widget: the drawing wins, so the
  // image never appears. That is what made Galloway's own artwork invisible.
  const clash = sampleDraft();
  clash.images.push({ role: 'battery', path: 'assets/battery.png', bytes: PNG, contentType: 'image/png', url: '' });
  const problems = validateDraft(clash, WIDGET_IDS, WIDGET_VARIANTS);
  assert.ok(problems.some((p) => p.level === 'warning' && /drawing wins/.test(p.text)), JSON.stringify(problems));
  assert.equal(problems.filter((p) => p.level === 'error').length, 0);

  // A role nothing draws is carried and never seen - also a warning.
  const unused = sampleDraft();
  unused.images.push({ role: 'radio', path: 'assets/radio.png', bytes: PNG, contentType: 'image/png', url: '' });
  assert.ok(validateDraft(unused, WIDGET_IDS, WIDGET_VARIANTS).some((p) => /never appear/.test(p.text)));

  // The hero image behind the live camera - the same class of mistake.
  const camera = sampleDraft(); camera.heroCamera = true;
  assert.ok(validateDraft(camera, WIDGET_IDS, WIDGET_VARIANTS).some((p) => /live camera/.test(p.text)));
});

await acheck('the package reads back as a zip with the right members', async () => {
  const zip = buildPackage(sampleDraft());
  const files = await readZip(zip);
  assert.deepEqual([...files.keys()].sort(), ['assets/hero.png', 'manifest.json', 'theme.json']);
  const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')));
  assert.equal(manifest.format, 'vanos-theme');
  assert.equal(manifest.version, 1);
  assert.equal(manifest.name, "Frankie's Pod");
  assert.equal(manifest.theme, 'theme.json');
  assert.deepEqual([...files.get('assets/hero.png')], [...PNG]);
});

await acheck('a package opens back into the same draft', async () => {
  const original = sampleDraft();
  const reopened = await draftFromPackage(buildPackage(original));
  assert.equal(reopened.name, original.name);
  assert.deepEqual(reopened.tokens, original.tokens);
  assert.deepEqual(reopened.hero, original.hero);
  assert.deepEqual(reopened.widgets, original.widgets);
  assert.equal(reopened.density, 'compact');
  assert.equal(reopened.heroCamera, false);
  assert.deepEqual(reopened.layout.items, original.layout.items);
  assert.equal(reopened.images.length, 1);
  assert.deepEqual([...reopened.images[0].bytes], [...PNG]);
  // And exporting it again produces the identical file.
  assert.deepEqual([...buildPackage(reopened)], [...buildPackage(original)]);
});

check('state-driven artwork: frames must be in the package', () => {
  const d = sampleDraft();
  d.artwork = { battery: { levels: [{ upTo: 50, image: 'assets/bat-low.png' }] } };
  const text = (x) => validateDraft(x, WIDGET_IDS, WIDGET_VARIANTS).map((p) => `${p.level}: ${p.text}`).join('\n');
  assert.match(text(d), /error: The artwork names assets\/bat-low\.png/);

  d.artImages = [{ role: '', path: 'assets/bat-low.png', bytes: PNG, contentType: 'image/png', url: '' }];
  assert.equal(validateDraft(d, WIDGET_IDS, WIDGET_VARIANTS).filter((p) => p.level === 'error').length, 0);
});

check('artwork and a drawing on the same widget is called out', () => {
  const d = sampleDraft();
  d.artwork = { battery: { levels: [{ upTo: 50, image: 'assets/bat-low.png' }] } };
  d.artImages = [{ role: '', path: 'assets/bat-low.png', bytes: PNG, contentType: 'image/png', url: '' }];
  d.widgets = { battery: { variant: 'illustrated' } };
  assert.ok(validateDraft(d, WIDGET_IDS, WIDGET_VARIANTS).some((p) => /artwork wins/.test(p.text)));
});

await acheck('a package carries the artwork and its frames, and reopens', async () => {
  const d = sampleDraft();
  d.artwork = {
    battery: {
      levels: [{ upTo: 25, image: 'assets/bat-25.png' }, { image: 'assets/bat-full.png' }],
      charging: 'assets/bat-charging.png',
    },
    weather: { conditions: { rain: 'assets/w-rain.png' } },
  };
  d.artImages = ['assets/bat-25.png', 'assets/bat-full.png', 'assets/bat-charging.png', 'assets/w-rain.png']
    .map((path) => ({ role: '', path, bytes: PNG, contentType: 'image/png', url: '' }));

  const def = themeDefinition(d);
  assert.equal(def.artwork.battery.charging, 'assets/bat-charging.png');
  assert.deepEqual(def.artwork.weather.conditions, { rain: 'assets/w-rain.png' });

  const files = await readZip(buildPackage(d));
  for (const frame of d.artImages) assert.ok(files.has(frame.path), frame.path);

  const reopened = await draftFromPackage(buildPackage(d));
  assert.deepEqual(reopened.artwork, def.artwork);
  assert.deepEqual(reopened.artImages.map((i) => i.path).sort(), d.artImages.map((i) => i.path).sort());
});

// Left on disk for the backend test to validate with the Pi's own code.
mkdirSync(join(here, '.artifacts'), { recursive: true });
writeFileSync(join(here, '.artifacts', 'studio-sample.vanos-theme'), buildPackage(sampleDraft()));
// And one with state-driven artwork, for the same backend check.
{
  const d = sampleDraft();
  d.artwork = {
    battery: {
      levels: [{ upTo: 25, image: 'assets/bat-25.png' }, { image: 'assets/bat-full.png' }],
      charging: 'assets/bat-charging.png',
      fill: { body: 'assets/body.png', fill: 'assets/liquid.png', bottom: 0.86, top: 0.14 },
    },
    solar: { bands: [{ upTo: 5, image: 'assets/s-idle.png' }, { image: 'assets/s-high.png' }] },
    weather: { conditions: { Rain: 'assets/w-rain.png' } },
  };
  d.artImages = ['assets/bat-25.png', 'assets/bat-full.png', 'assets/bat-charging.png', 'assets/body.png',
    'assets/liquid.png', 'assets/s-idle.png', 'assets/s-high.png', 'assets/w-rain.png']
    .map((path) => ({ role: '', path, bytes: PNG, contentType: 'image/png', url: '' }));
  writeFileSync(join(here, '.artifacts', 'studio-artwork.vanos-theme'), buildPackage(d));
}

console.log(`\n${passed} theme-studio checks passed`);
