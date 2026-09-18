/**
 * BUILT-IN COMPOSITIONS MUST VALIDATE.
 *
 * A built-in appearance goes through the same parseLayout, against the
 * same widget registry, as a composition arriving inside an installed
 * .vanos-theme package. That is only true while it HOLDS - so this
 * asserts it, rather than trusting a comment.
 *
 * At runtime a built-in that fails validation is logged and skipped, so
 * the van still starts. That means a broken built-in would otherwise be
 * silent until someone noticed a missing cockpit. This test is what
 * makes it loud, in CI, before it ships.
 *
 * Run: node tests/builtin-compositions.test.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { strict as assert } from 'node:assert';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const builtinsDir = join(root, 'src/layout/builtins');

/** Bundle the real schema. The widget components are stubbed: the
 *  registry is imported for its IDS, and pulling React in to read a
 *  list of strings would make this test fail for reasons that have
 *  nothing to do with layouts. */
const stubWidgets = {
  name: 'stub-widget-components',
  setup(b) {
    b.onResolve({ filter: /Widget$/ }, (args) => ({ path: args.path, namespace: 'stub' }));
    // CommonJS, so any named import resolves: the registry imports one
    // named component per file and this test should not have to list
    // them.
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'module.exports = new Proxy({}, { get: () => function Stub() { return null; } });',
      loader: 'js',
    }));
  },
};

const bundled = await build({
  stdin: {
    contents: `
      export { parseLayout, assertCompositionSupported, LayoutError } from '@/layout/schema';
      export { WIDGET_IDS } from '@/components/widgets/registry';
    `,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  alias: { '@': join(root, 'src') },
  plugins: [stubWidgets],
});

const mod = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);
const { parseLayout, assertCompositionSupported, LayoutError, WIDGET_IDS } = mod;

let passed = 0;
function ok(name) {
  console.log(`  ok  ${name}`);
  passed += 1;
}

// The registry must have loaded for anything below to mean anything: an
// empty WIDGET_IDS would make every layout "valid" by rejecting nothing.
assert.ok(WIDGET_IDS.length > 3, `widget registry looks empty: ${JSON.stringify(WIDGET_IDS)}`);
ok(`widget registry has ${WIDGET_IDS.length} ids`);

// Every JSON file in builtins/ is a shipped composition. Discovered from
// disk, not listed here, so a new built-in is covered the moment it is
// added rather than when someone remembers to add it to this test.
const files = readdirSync(builtinsDir).filter((f) => f.endsWith('.json'));
assert.ok(files.length > 0, 'no built-in compositions found');

for (const file of files) {
  const raw = JSON.parse(readFileSync(join(builtinsDir, file), 'utf8'));
  let layout;
  let skipped;
  try {
    ({ layout, skipped } = parseLayout(raw, WIDGET_IDS));
  } catch (err) {
    // Reported rather than rethrown: the bundle runs from a data: URL,
    // so its stack trace is a page of base64. The message is the useful
    // part and it is the same message a theme author would see.
    assert.fail(`${file}: rejected by the layout validator - ${err.message}`);
  }

  assert.ok(layout.items.length > 0, `${file}: parsed to an empty layout`);
  // A skipped id means the built-in names a widget this build does not
  // have. In a package that is an acceptable degrade; in a built-in it
  // is a typo that would ship a blank slot.
  assert.deepEqual(skipped, [], `${file}: names unknown widgets ${JSON.stringify(skipped)}`);
  ok(`${file} validates (${layout.items.length} items, no unknown widgets)`);
}

// The other half of the rule: a composition naming a cockpit the
// renderer cannot draw must be REFUSED, not accepted and ignored. If
// this ever stops throwing, the third failure class is back.
assert.throws(
  () => assertCompositionSupported({ home: { layout: { version: 1, items: [] } }, cockpit: 'instrument' }, ['adventure']),
  LayoutError,
  'an unsupported cockpit composition was accepted',
);
ok('composition for an unsupported cockpit is refused');

assert.throws(
  () => assertCompositionSupported({ home: { layout: { version: 1, items: [] } } }, ['adventure']),
  LayoutError,
  'a composition with no cockpit named was accepted',
);
ok('composition naming no cockpit is refused');

// And it must NOT refuse the supported case, or no package could ever
// carry a layout.
assertCompositionSupported({ home: { layout: { version: 1, items: [] } }, cockpit: 'adventure' }, ['adventure']);
ok('composition for a supported cockpit is accepted');

console.log(`\n${passed} checks passed`);
