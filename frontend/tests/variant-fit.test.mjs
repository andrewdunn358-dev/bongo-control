/**
 * Variant fallback rules.
 *
 * resolveVariant is deliberately pure so these can run without a
 * browser. A variant that does not fit must fall back to the standard
 * drawing - never be squeezed into a slot too small to read it in, and
 * never take the widget's readings down with it.
 *
 * Run: node tests/variant-fit.test.mjs
 */
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

// The source is TypeScript; strip the types rather than add a build
// step for one pure function. If this ever stops being trivial, the
// function has grown too complicated for what it is.
const src = readFileSync(new URL('../src/layout/variantFit.ts', import.meta.url), 'utf8');
const js = src
  .replace(/^import[^\n]*\n/gm, '')
  .replace(/^export (interface|type)[\s\S]*?\n\}\n/gm, '')
  .replace(/^export type [^\n]*\n/gm, '')
  .replace(/: \{ width: number; height: number \} \| null/g, '')
  .replace(/: string \| undefined/g, '')
  .replace(/: VariantTable/g, '')
  .replace(/: WidgetState/g, '')
  .replace(/\): VariantDecision \{/g, ') {')
  .replace(/export const STANDARD[^\n]*/, 'const STANDARD = "standard";')
  .replace(/^export /gm, '');
const mod = new Function(`${js}; return { resolveVariant, STANDARD };`)();
const { resolveVariant } = mod;

const GALLOWAY = { minWidth: 260, minHeight: 200, states: ['full'] };
const TABLE = { galloway: GALLOWAY };
const BIG = { width: 400, height: 300 };

let passed = 0;
function check(name, actual, expected) {
  assert.deepEqual(actual, expected, `${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  console.log(`  ok  ${name}`);
  passed += 1;
}

// 1. No variant asked for - the normal case, and the one that must
//    never change behaviour.
check('no variant requested -> standard',
  resolveVariant(undefined, TABLE, 'full', BIG),
  { variant: 'standard', reason: 'no-variant-requested' });

check('standard requested explicitly -> standard',
  resolveVariant('standard', TABLE, 'full', BIG),
  { variant: 'standard', reason: 'no-variant-requested' });

// 2. A theme built for a newer VanOS. It must lose the drawing, not
//    the widget.
check('unknown variant -> standard',
  resolveVariant('aurora-borealis', TABLE, 'full', BIG),
  { variant: 'standard', reason: 'unknown-variant' });

// 3. The variant fits.
check('fits -> the requested variant',
  resolveVariant('galloway', TABLE, 'full', BIG),
  { variant: 'galloway', reason: 'requested' });

// 4. THE POINT OF THE WHOLE MECHANISM: too small to draw properly.
check('slot too narrow -> standard',
  resolveVariant('galloway', TABLE, 'full', { width: 259, height: 300 }),
  { variant: 'standard', reason: 'too-narrow' });

check('slot too short -> standard',
  resolveVariant('galloway', TABLE, 'full', { width: 400, height: 199 }),
  { variant: 'standard', reason: 'too-short' });

check('exactly at the minimum -> the variant (a minimum is usable)',
  resolveVariant('galloway', TABLE, 'full', { width: 260, height: 200 }),
  { variant: 'galloway', reason: 'requested' });

// 5. A variant that never claimed a compact form.
check('state it does not implement -> standard',
  resolveVariant('galloway', TABLE, 'compact', BIG),
  { variant: 'standard', reason: 'state-unsupported' });

// 6. First paint, before the slot has been measured.
check('not measured yet -> standard',
  resolveVariant('galloway', TABLE, 'full', null),
  { variant: 'standard', reason: 'not-measured-yet' });

// 7. A variant that DOES claim compact is honoured there.
check('variant supporting compact -> used in compact',
  resolveVariant('galloway', { galloway: { ...GALLOWAY, states: ['full', 'compact'] } }, 'compact', BIG),
  { variant: 'galloway', reason: 'requested' });

// 8. An empty table is the normal state for widgets with no variants.
check('widget with no variant table -> standard',
  resolveVariant('galloway', {}, 'full', BIG),
  { variant: 'standard', reason: 'unknown-variant' });

console.log(`\n  ${passed} checks passed`);
