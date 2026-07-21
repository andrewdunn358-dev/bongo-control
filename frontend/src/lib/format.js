export const fmtNum = (n, digits = 1) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1000) return `${(n / 1000).toFixed(digits)}k`;
  return Number(n).toFixed(digits);
};

export const fmtInt = (n) => (n === null || n === undefined ? '—' : Math.round(n).toLocaleString());

export const fmtWatts = (w) => `${fmtNum(w, 0)} W`;

export const fmtVolt = (v) => `${fmtNum(v, 2)} V`;

export const fmtAmp = (a) => `${fmtNum(a, 1)} A`;

export const fmtPct = (p) => `${fmtNum(p, 0)}%`;

export const fmtTemp = (c) => `${fmtNum(c, 1)}°`;

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const signalToBars = (dbm) => {
  if (dbm >= -55) return 4;
  if (dbm >= -65) return 3;
  if (dbm >= -75) return 2;
  return 1;
};
