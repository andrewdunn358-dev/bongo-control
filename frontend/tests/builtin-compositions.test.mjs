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

/** Bundle the real schema, registry and resolver. Everything that needs
 *  a DOM is stubbed - the widget components, the hooks and the renderer.
 *  The three functions under test are pure; pulling React and a
 *  stylesheet in behind them would make this test fail for reasons that
 *  have nothing to do with layouts. */
const STUBBED = /Widget$|useAutoFit|useLayoutMode|useCockpitTheme|LayoutRenderer|\.css$/;
const stubDom = {
  name: 'stub-dom-dependencies',
  setup(b) {
    b.onResolve({ filter: STUBBED }, (args) => ({ path: args.path, namespace: 'stub' }));
    // CommonJS, so any named import resolves: the registry imports one
    // named component per file and this test should not have to list
    // them.
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'module.exports = new Proxy({}, { get: () => function Stub() { return null; } });',
      loader: 'js',
    }));
  },
};

/** Replaces one built-in's JSON at bundle time. This is what lets the
 *  REAL module-init path be tested: BUILTIN_COMPOSITIONS is built when
 *  layout/builtins is first imported, so a broken built-in has to be
 *  broken before that import, not after it. Calling loadCompositions
 *  by hand exercises the function but not the wiring. */
function replaceSource(file, json) {
  return {
    name: 'replace-builtin-source',
    setup(b) {
      b.onLoad({ filter: new RegExp(`builtins[/\\\\]${file}$`) }, () => ({
        contents: JSON.stringify(json),
        loader: 'json',
      }));
    },
  };
}

async function load(extraPlugins = []) {
  const bundled = await build({
    stdin: {
      contents: `
        export { parseLayout } from '@/layout/schema';
        export { WIDGET_IDS } from '@/components/widgets/registry';
        export { resolveComposition } from '@/layout/ThemedHome';
        export { loadCompositions, EMERGENCY_COMPOSITION, builtinComposition } from '@/layout/builtins';
      `,
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    alias: { '@': join(root, 'src') },
    plugins: [...extraPlugins, stubDom],
    jsx: 'transform',
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
  );
}

/** Runs `fn` with console.error captured, for the cases whose failure
 *  output is the expected result rather than a problem. The bundle runs
 *  from a data: URL, so an uncaptured stack is a page of base64. */
async function quietly(fn) {
  const said = [];
  const real = console.error;
  console.error = (...a) =>
    said.push(a.map((x) => (x instanceof Error ? x.message : String(x))).join(' '));
  try {
    return [await fn(), said];
  } finally {
    console.error = real;
  }
}

const mod = await load();
const { parseLayout, WIDGET_IDS, resolveComposition } = mod;
const { loadCompositions, EMERGENCY_COMPOSITION, builtinComposition } = mod;

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

// THE INVARIANT THAT MADE THE OLD IMPORT CHECK OBSOLETE.
//
// A Theme Definition's OWN composition is drawn whatever it names. An
// earlier Stage 1 draft refused, at import, a package carrying a layout
// while naming a cockpit with no renderer path - because such a layout
// used to be accepted and then silently discarded. It is not any more,
// and the check was rejecting themes that work.
//
// This is what replaced it. If any of these three stop holding, that
// discard path is back and the refusal is needed again - so this test
// failing is the signal to reinstate it, not to delete the assertion.
const OWN = { version: 1, items: [{ widget: 'battery', span: 6 }, { widget: 'solar', span: 6 }] };

// 'adventure' is the discriminating case and must stay in this list. It
// is the only name with a built-in to lose to, so it is the only one
// that fails if the precedence is ever reversed. Checked: inverting
// resolveComposition to `builtin ?? themeLayout` leaves the other two
// passing, because there is no built-in for them either way.
for (const named of ['adventure', 'instrument', 'control']) {
  assert.deepEqual(
    resolveComposition(named, OWN), OWN,
    `a theme naming "${named}" had its own composition discarded`,
  );
  ok(`own composition wins over the "${named}" base it extends`);
}

// Bringing none of its own, a Theme Definition inherits the built-in it
// extends - which is what lets a tokens-only package work unchanged.
assert.equal(
  resolveComposition('adventure', undefined)?.items.length,
  JSON.parse(readFileSync(join(builtinsDir, 'adventure.home.json'), 'utf8')).items.length,
  'a theme with no composition did not inherit the built-in it extends',
);
ok('no own composition -> inherits the extended built-in');

// And an appearance that is still a hand-written component resolves to
// nothing, so Home falls back to it rather than rendering an empty grid.
assert.equal(
  resolveComposition('instrument', undefined), undefined,
  'an unmigrated appearance resolved to a composition it does not have',
);
ok('unmigrated appearance resolves to undefined, not an empty layout');

// ---------------------------------------------------------------------
// THE FAILURE PATH.
//
// Measured before this existed: a built-in that failed validation was
// logged and dropped, resolution returned undefined, Home took the
// legacy branch, and Adventure has no component - so the cockpit
// rendered BLANK. Asserting only that the shipped JSON parses would not
// have caught that, because the shipped JSON does parse. What follows
// breaks a source deliberately and checks what resolution gives back.

// The fallback is useless if it is not itself valid, and it is parsed by
// the same validator as everything else - so check it exists first.
assert.ok(EMERGENCY_COMPOSITION, 'the emergency composition failed to validate');
assert.ok(EMERGENCY_COMPOSITION.items.length > 0, 'the emergency composition is empty');
ok(`emergency composition validates (${EMERGENCY_COMPOSITION.items.length} items)`);

const BROKEN = { version: 1, items: [{ widget: 'battery', span: 99 }] };
// The failure is deliberate, so its console.error is the expected
// result rather than a problem.
const [degraded, said] = await quietly(() =>
  loadCompositions({ adventure: BROKEN }, EMERGENCY_COMPOSITION),
);

assert.ok(
  said.some((l) => l.includes('failed validation')),
  'the validation failure was not logged',
);
assert.ok(
  said.some((l) => l.includes('emergency composition')),
  'the fallback was not reported - a silent substitution is its own problem',
);
ok('validation failure and the substitution are both logged');

assert.notEqual(
  degraded.adventure, undefined,
  'an invalid built-in resolved to undefined - this is the blank-cockpit path',
);
assert.ok(
  degraded.adventure?.items.length > 0,
  'an invalid built-in resolved to an empty composition',
);
assert.deepEqual(
  degraded.adventure, EMERGENCY_COMPOSITION,
  'an invalid built-in did not fall back to the emergency composition',
);
ok('invalid built-in -> emergency composition, not undefined');

// AND IT MUST SURVIVE THE REAL RESOLUTION PATH, not merely exist in a
// map. The map above is loadCompositions' return value; what decides
// what ThemedHome draws is resolveComposition reading the module-level
// BUILTIN_COMPOSITIONS, built once when layout/builtins is imported.
//
// So this loads a SECOND copy of the module graph with adventure's JSON
// replaced by the broken layout at bundle time - the built-in is
// therefore already broken when the module initialises, exactly as it
// would be on a device that shipped a bad file - and then asks the real
// resolver what Adventure resolves to.
const [broken] = await quietly(() => load([replaceSource('adventure.home.json', BROKEN)]));
const resolved = broken.resolveComposition('adventure', undefined);

assert.notEqual(
  resolved, undefined,
  'with a broken built-in, resolution returned undefined - this is the blank-cockpit path',
);
assert.ok(resolved.items.length > 0, 'resolution returned an empty composition');
assert.deepEqual(
  resolved, broken.EMERGENCY_COMPOSITION,
  'resolution did not return the emergency composition after a built-in failure',
);
// Not vacuous: the emergency composition must differ from the built-in
// it replaced, or this would pass even if the failure never happened.
assert.notDeepEqual(
  resolved,
  parseLayout(
    JSON.parse(readFileSync(join(builtinsDir, 'adventure.home.json'), 'utf8')), WIDGET_IDS,
  ).layout,
  'resolution returned the real Adventure composition, so the built-in was never broken',
);
ok('broken built-in -> resolveComposition returns the emergency composition');

assert.ok(
  resolved.items.every((i) => WIDGET_IDS.includes(i.widget)),
  'the emergency composition names a widget this build does not have',
);
ok('emergency composition is renderable - every widget is registered');

// The same module must still give Instrument its component, so a broken
// Adventure cannot take the other cockpits down with it.
assert.equal(
  broken.resolveComposition('instrument', undefined), undefined,
  'a broken built-in changed what an unmigrated appearance resolves to',
);
ok('a broken built-in does not affect the unmigrated appearances');

// An appearance with NO built-in must still resolve to undefined, so
// Instrument and Control keep their own components. Conflating "failed
// to validate" with "has no built-in" would take that away from them.
assert.equal(
  builtinComposition('instrument'), undefined,
  'an unmigrated appearance was given the emergency composition, which would replace its cockpit',
);
assert.equal(
  loadCompositions({}, EMERGENCY_COMPOSITION).instrument, undefined,
  'an id with no source gained an entry',
);
ok('unmigrated appearance still resolves to undefined, not the fallback');

console.log(`\n${passed} checks passed`);
