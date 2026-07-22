import type { ReactNode } from 'react';

type Tone = 'green' | 'amber' | 'red' | 'teal' | 'purple';

const TONE: Record<Tone, { from: string; to: string; glow: string }> = {
  green: { from: '#34d399', to: '#22d3ee', glow: 'rgba(52,211,153,0.55)' },
  amber: { from: '#fbbf24', to: '#f59e0b', glow: 'rgba(245,158,11,0.5)' },
  red: { from: '#fb7185', to: '#f43f5e', glow: 'rgba(244,63,94,0.5)' },
  teal: { from: '#22d3ee', to: '#38bdf8', glow: 'rgba(34,211,238,0.5)' },
  purple: { from: '#a855f7', to: '#6366f1', glow: 'rgba(168,85,247,0.5)' },
};

/**
 * Glowing circular gauge ring (the design's signature element). Used for
 * the Home SITREP status and anywhere a single value/state wants a ring.
 * `progress` is 0..1 of the circle to fill; the center holds `children`
 * (an icon, a value). Purely presentational.
 */
export function GaugeRing({
  tone = 'teal',
  progress = 1,
  size = 96,
  stroke = 7,
  children,
}: {
  tone?: Tone;
  progress?: number;
  size?: number;
  stroke?: number;
  children?: ReactNode;
}) {
  const t = TONE[tone];
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, progress));
  const gid = `gauge-${tone}`;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ filter: `drop-shadow(0 0 10px ${t.glow})` }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={t.glow} strokeOpacity={0.25} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${gid})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={t.from} />
            <stop offset="1" stopColor={t.to} />
          </linearGradient>
        </defs>
      </svg>
      {children && <div className="absolute inset-0 grid place-items-center">{children}</div>}
    </div>
  );
}
