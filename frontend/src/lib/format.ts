/**
 * Honest formatters.
 *
 * Rule: null / undefined / non-finite -> "—". We never coerce nulls to 0
 * because the whole project depends on distinguishing "no reading" from
 * "zero reading". If a real hardware source reports zero, we render 0;
 * if it reports null, we render an em-dash.
 */

export const DASH = '—';

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function fmtNum(v: number | null | undefined, digits = 1): string {
  if (!finite(v)) return DASH;
  return v.toFixed(digits);
}

export function fmtInt(v: number | null | undefined): string {
  if (!finite(v)) return DASH;
  return Math.round(v).toLocaleString();
}

export function fmtVolt(v: number | null | undefined) {
  return finite(v) ? `${v.toFixed(2)} V` : `${DASH} V`;
}

export function fmtAmp(v: number | null | undefined) {
  return finite(v) ? `${v.toFixed(1)} A` : `${DASH} A`;
}

export function fmtWatt(v: number | null | undefined) {
  return finite(v) ? `${Math.round(v)} W` : `${DASH} W`;
}

export function fmtWh(v: number | null | undefined) {
  if (!finite(v)) return `${DASH} Wh`;
  const abs = Math.abs(v);
  if (abs >= 1000) return `${(v / 1000).toFixed(2)} kWh`;
  return `${Math.round(v)} Wh`;
}

export function fmtTemp(v: number | null | undefined) {
  return finite(v) ? `${v.toFixed(1)}°` : DASH;
}

export function fmtPct(v: number | null | undefined) {
  return finite(v) ? `${Math.round(v)}%` : DASH;
}

export function fmtDistance(m: number | null | undefined) {
  if (!finite(m)) return DASH;
  if (m < 950) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

export function fmtMJ(v: number | null | undefined) {
  return finite(v) ? `${v.toFixed(1)} MJ` : DASH;
}

/**
 * Sunrise/sunset arrive as local strings with NO timezone suffix, e.g.
 * "2026-07-20T04:53". Parsing them with `new Date()` reinterprets them
 * in the browser's timezone and shifts them. Slice the string instead.
 */
export function fmtLocalTime(s: string | null | undefined): string {
  if (!s || typeof s !== 'string') return DASH;
  const idx = s.indexOf('T');
  if (idx === -1) return s;
  return s.slice(idx + 1, idx + 6); // "HH:MM"
}

export function fmtUnixTime(sec: number | null | undefined): string {
  if (!finite(sec)) return DASH;
  const d = new Date(sec * 1000);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export function signalToBars(dbm: number | null | undefined): number {
  if (!finite(dbm)) return 0;
  if (dbm >= -55) return 4;
  if (dbm >= -65) return 3;
  if (dbm >= -75) return 2;
  return 1;
}

/** WMO weather-code → friendly label (short). */
export function wmoLabel(code: number | null | undefined): string {
  if (!finite(code)) return DASH;
  if (code === 0) return 'Clear';
  if ([1, 2].includes(code)) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if ([45, 48].includes(code)) return 'Fog';
  if (code >= 51 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code >= 95) return 'Thunder';
  return 'Unknown';
}
