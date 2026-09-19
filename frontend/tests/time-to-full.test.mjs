/**
 * TIME TO FULL - a derived ESTIMATE, never an invented one.
 *
 * Runs the real lib/batteryDerive.ts and lib/format.ts (bundled with
 * esbuild, like the other tests here). Every "unknown" case must come
 * back null - not zero, not a plausible-looking number.
 *
 * Run: node tests/time-to-full.test.mjs
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
      export { estimateTimeToFull, timeToFullMins, RESTING_CURRENT_A } from '@/lib/batteryDerive';
      export { fmtDuration, DASH } from '@/lib/format';
    `,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  alias: { '@': join(root, 'src') },
});
const tmp = join(root, 'tests', '.time-to-full.bundle.mjs');
writeFileSync(tmp, bundled.outputFiles[0].text);
let m;
try {
  m = await import(tmp);
} finally {
  rmSync(tmp, { force: true });
}
const { estimateTimeToFull, timeToFullMins, fmtDuration, DASH } = m;

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

// Leisure battery alone, shunt synchronised, charging at 10 A net.
const charging = {
  soc_pct: 60,
  voltage: 13.6,
  charging: true,
  current_a: 10,
  bank_amp_hours: 120,
  external_connected: false,
  soc_is_derived: false,
};

check('valid charging battery -> estimated time', () => {
  // 40% of 120 Ah = 48 Ah; 48 Ah / 10 A = 4.8 h = 288 min.
  const r = estimateTimeToFull(charging);
  assert.equal(r.minutes, 288);
  assert.equal(r.reason, 'estimated');
  assert.equal(fmtDuration(r.minutes), '4h 48m');
});

check('the "2h 14m" case the theme wants to show', () => {
  // 25% of 120 Ah = 30 Ah; 30 / 13.4333 A = 2.2333 h = 134 min.
  const mins = timeToFullMins({ ...charging, soc_pct: 75, current_a: 30 / (134 / 60) });
  assert.equal(mins, 134);
  assert.equal(fmtDuration(mins), '2h 14m');
});

check('not charging -> null', () => {
  assert.equal(timeToFullMins({ ...charging, charging: false }), null);
  assert.equal(estimateTimeToFull({ ...charging, charging: false }).reason, 'not-charging');
});

check('missing SOC -> null', () => {
  assert.equal(timeToFullMins({ ...charging, soc_pct: null }), null);
  assert.equal(timeToFullMins({ ...charging, soc_pct: undefined }), null);
  assert.equal(timeToFullMins({ ...charging, soc_pct: Number.NaN }), null);
  assert.equal(estimateTimeToFull({ ...charging, soc_pct: null }).reason, 'no-soc');
});

check('missing capacity -> null', () => {
  assert.equal(timeToFullMins({ ...charging, bank_amp_hours: null }), null);
  assert.equal(timeToFullMins({ ...charging, bank_amp_hours: undefined }), null);
  assert.equal(timeToFullMins({ ...charging, bank_amp_hours: 0 }), null);
  assert.equal(estimateTimeToFull({ ...charging, bank_amp_hours: null }).reason, 'no-capacity');
});

check('zero / negative / resting / missing charge current -> null', () => {
  for (const current_a of [0, -4, 0.2, 0.1, null, undefined]) {
    assert.equal(timeToFullMins({ ...charging, current_a }), null, `current_a=${current_a}`);
  }
  // No shunt at all: MPPT says charging with power, but no measured
  // current into the battery. MPPT output is not used as a substitute.
  assert.equal(
    timeToFullMins({ soc_pct: null, voltage: 13.4, charging: true, charging_power_w: 180 }),
    null,
  );
});

check('100% SOC -> zero, already full', () => {
  const r = estimateTimeToFull({ ...charging, soc_pct: 100, current_a: 0.05 });
  assert.equal(r.minutes, 0);
  assert.equal(r.reason, 'full');
  assert.equal(fmtDuration(0), '0m');
});

check('external battery on, SOC still the shunt\'s own -> null (bases differ)', () => {
  const r = estimateTimeToFull({ ...charging, bank_amp_hours: 250, external_connected: true, soc_is_derived: false });
  assert.equal(r.minutes, null);
  assert.equal(r.reason, 'soc-capacity-mismatch');
});

check('external battery on, SOC recalculated for the combined bank -> estimate', () => {
  // 40% of 250 Ah = 100 Ah; 100 / 20 A = 5 h.
  const mins = timeToFullMins({ ...charging, bank_amp_hours: 250, external_connected: true, soc_is_derived: true, current_a: 20 });
  assert.equal(mins, 300);
});

check('no payload -> null', () => {
  assert.equal(timeToFullMins(null), null);
  assert.equal(timeToFullMins(undefined), null);
});

check('unknown formats as a dash, never as zero', () => {
  assert.equal(fmtDuration(null), DASH);
  assert.equal(fmtDuration(undefined), DASH);
  assert.equal(fmtDuration(45), '45m');
});

console.log(`\n${passed} time-to-full checks passed`);
