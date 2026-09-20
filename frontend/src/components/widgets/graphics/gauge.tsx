import { useId } from 'react';
import type { BatteryGraphicProps } from './types';

/**
 * THE GAUGE BATTERY - a segmented ring around a glass cell.
 *
 * Drawn from Frankie's reference artwork. Every moving part is driven by
 * a real reading, and nothing is drawn that isn't measured:
 *
 *   - the ring lights up to the state of charge, segment by segment,
 *     along a fixed red -> amber -> green -> teal scale. The scale is
 *     FIXED, not themeable: it carries meaning (nearly empty vs full),
 *     the same reasoning that keeps the status colours out of themes.
 *   - the cell's liquid sits at the state of charge.
 *   - charging adds a glow that breathes, and the bolt. Both are absent
 *     when the van is not charging, so the drawing can never suggest
 *     current that isn't flowing.
 *   - NO state of charge (no shunt, or one that hasn't synchronised)
 *     means an unlit ring and an empty cell, with a dashed outline
 *     saying "unknown". It never falls back to a plausible-looking
 *     level - that is the one thing a battery drawing must not do.
 *
 * Motion respects prefers-reduced-motion.
 */

/** Segment count around the ring. 24 keeps each segment ~4% of charge,
 *  which reads cleanly at tablet size without looking like a bar chart. */
const SEGMENTS = 24;
/** The arc the ring covers, in degrees, starting at the lower left and
 *  sweeping clockwise. The gap at the bottom is where the cell's shadow
 *  falls in the reference. */
const START_ANGLE = 145;
const SWEEP = 250;

const CENTRE = 100;
const RADIUS = 84;

/** Red at empty through to teal at full. Fixed meaning, not decoration. */
function segmentColour(fraction: number): string {
  if (fraction < 0.2) return 'rgb(var(--status-red))';
  if (fraction < 0.4) return 'rgb(var(--status-amber))';
  if (fraction < 0.55) return '#c8e14a';
  if (fraction < 0.85) return 'rgb(var(--status-green))';
  return 'rgb(var(--aurora-teal))';
}

function segmentPath(index: number): string {
  const per = SWEEP / SEGMENTS;
  const gap = per * 0.18;
  const from = START_ANGLE + index * per + gap / 2;
  const to = from + per - gap;
  const point = (deg: number, r: number) => {
    const rad = (deg * Math.PI) / 180;
    return `${(CENTRE + r * Math.cos(rad)).toFixed(2)} ${(CENTRE + r * Math.sin(rad)).toFixed(2)}`;
  };
  const outer = RADIUS;
  const inner = RADIUS - 15;
  return [
    `M ${point(from, outer)}`,
    `A ${outer} ${outer} 0 0 1 ${point(to, outer)}`,
    `L ${point(to, inner)}`,
    `A ${inner} ${inner} 0 0 0 ${point(from, inner)}`,
    'Z',
  ].join(' ');
}

export function GaugeBattery({ soc, charging, size }: BatteryGraphicProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const known = typeof soc === 'number' && Number.isFinite(soc);
  const value = known ? Math.max(0, Math.min(100, soc as number)) : 0;
  const lit = known ? Math.round((value / 100) * SEGMENTS) : 0;

  // The cell's window, and how much of it the liquid fills.
  const cellTop = 66;
  const cellHeight = 62;
  const fill = (cellHeight - 4) * (value / 100);

  return (
    <svg
      className={`vw-illustrated vw-gauge${charging && known ? ' vw-gauge-charging' : ''}`}
      width={size}
      height={size}
      viewBox="0 0 200 200"
      role="img"
      aria-label={known ? `Battery ${Math.round(value)} percent${charging ? ', charging' : ''}` : 'Battery charge unknown'}
    >
      <defs>
        <linearGradient id={`gaugeFill-${uid}`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor={segmentColour(value / 100)} stopOpacity=".95" />
          <stop offset="1" stopColor={segmentColour(Math.min(1, value / 100 + 0.2))} stopOpacity=".7" />
        </linearGradient>
        <clipPath id={`gaugeCell-${uid}`}>
          <rect x="79" y={cellTop} width="42" height={cellHeight} rx="7" />
        </clipPath>
      </defs>

      {/* The ring. Unlit segments stay visible, so the scale reads as a
          gauge rather than as a partial arc of unknown length. */}
      <g>
        {Array.from({ length: SEGMENTS }, (_, i) => {
          const isLit = i < lit;
          return (
            <path
              key={i}
              d={segmentPath(i)}
              fill={isLit ? segmentColour((i + 0.5) / SEGMENTS) : 'rgb(var(--ink))'}
              opacity={isLit ? 0.95 : 0.12}
            />
          );
        })}
      </g>

      {/* Inner well */}
      <circle cx={CENTRE} cy={CENTRE} r={RADIUS - 19} fill="var(--vw-panel)" opacity=".75" />
      <circle cx={CENTRE} cy={CENTRE} r={RADIUS - 19} fill="none" stroke="var(--vw-role-illustration-soft)" strokeWidth="1.5" opacity=".5" />

      {/* The cell */}
      <rect x="90" y="58" width="20" height="7" rx="2.5" fill="var(--vw-role-illustration)" opacity=".85" />
      <rect
        x="79" y={cellTop} width="42" height={cellHeight} rx="7"
        fill="var(--vw-panel2)"
        stroke="var(--vw-role-illustration)"
        strokeWidth="2.5"
        strokeDasharray={known ? undefined : '5 4'}
        opacity={known ? 1 : 0.7}
      />
      {known && fill > 0 && (
        <g clipPath={`url(#gaugeCell-${uid})`}>
          <rect x="81" y={cellTop + cellHeight - 2 - fill} width="38" height={fill} rx="4" fill={`url(#gaugeFill-${uid})`} />
          {/* Banding, so a full cell doesn't read as a flat block. */}
          <g opacity=".18" fill="rgb(var(--surface))">
            <rect x="81" y={cellTop + cellHeight - 2 - fill + 6} width="38" height="2" />
            <rect x="81" y={cellTop + cellHeight - 2 - fill + 18} width="38" height="2" />
            <rect x="81" y={cellTop + cellHeight - 2 - fill + 30} width="38" height="2" />
          </g>
        </g>
      )}
      {/* Glass highlight */}
      <rect x="84" y={cellTop + 4} width="6" height={cellHeight - 14} rx="3" fill="rgb(var(--ink))" opacity=".12" />

      {charging && known && (
        <g className="vw-gauge-bolt">
          <path d="M104 78 l-13 22 h9 l-4 20 15-26h-10z" fill="rgb(var(--status-amber))" />
        </g>
      )}

      <style>{`
        .vw-gauge-charging { filter: drop-shadow(0 0 6px rgb(var(--status-green) / .35)); }
        .vw-gauge-charging { animation: vw-gauge-breathe 2.6s ease-in-out infinite; }
        .vw-gauge-bolt { animation: vw-gauge-bolt 2.6s ease-in-out infinite; transform-origin: 100px 100px; }
        @keyframes vw-gauge-breathe {
          0%, 100% { filter: drop-shadow(0 0 4px rgb(var(--status-green) / .25)); }
          50% { filter: drop-shadow(0 0 12px rgb(var(--status-green) / .5)); }
        }
        @keyframes vw-gauge-bolt {
          0%, 100% { opacity: .75; }
          50% { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .vw-gauge, .vw-gauge * { animation: none !important; }
        }
      `}</style>
    </svg>
  );
}
