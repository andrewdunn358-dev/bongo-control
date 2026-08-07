import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import type { GpsSatellite } from '@/lib/types';

const QUALITY_COLOR: Record<GpsSatellite['quality'], string> = {
  strong: '#22d3ee',
  good: '#10b981',
  fair: '#f59e0b',
  poor: '#7dd3fc',
  'not tracking': '#7dd3fc',
};

/**
 * SatelliteSky — decorative beams-from-the-sky visual for the hero
 * section. Ported from an Emergent-generated design (design credit:
 * that source) but rewired to real data - api.gpsSatellites(), the
 * same endpoint and query key the Settings sky-plot uses, so both
 * share one cached fetch rather than polling independently.
 *
 * The projection here is a deliberate stylised simplification, not a
 * literal polar sky-plot (compare components/GpsSatellites.tsx in
 * Settings, which IS accurate for that purpose): x spreads by azimuth,
 * y is driven by elevation alone. That's intentional for a hero
 * decoration meant to evoke "satellites in the sky above", not serve
 * as a navigational instrument - kept as-is from the original design
 * rather than "fixed" into something more technical than this context
 * calls for.
 */
export function SatelliteSky({ compact = false, className }: { compact?: boolean; className?: string }) {
  const sats = useQuery({ queryKey: ['gps-satellites'], queryFn: api.gpsSatellites, retry: false });
  const list = (sats.data?.satellites ?? []).filter((s) => s.elevation != null && s.azimuth != null).slice(0, 6);

  if (list.length === 0) return null; // no real data yet - nothing honest to draw

  const w = 100;
  const h = compact ? 45 : 60;
  const cx = 50;
  const cy = h;
  const R = compact ? 44 : 58;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={`absolute inset-0 h-full w-full ${className ?? ''}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="satGlow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
        </radialGradient>
      </defs>
      {list.map((s, i) => {
        const az = ((s.azimuth as number) - 90) * (Math.PI / 180);
        const x = cx + Math.cos(az) * (R * (1 - (s.elevation as number) / 90));
        const y = cy - R * ((s.elevation as number) / 90);
        const color = QUALITY_COLOR[s.quality];
        return (
          <g key={`${s.constellation}-${s.prn}`}>
            <motion.line
              x1={cx} y1={cy} x2={x} y2={y}
              stroke={color}
              strokeWidth="0.2"
              strokeDasharray="1 1.2"
              strokeOpacity="0.55"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.4, delay: i * 0.12, ease: 'easeOut' }}
            />
            <circle cx={x} cy={y} r="1.2" fill="url(#satGlow)" />
            <motion.circle
              cx={x} cy={y} r="0.5"
              fill={color}
              animate={{ opacity: [1, 0.5, 1] }}
              transition={{ duration: 2 + i * 0.3, repeat: Infinity }}
            />
          </g>
        );
      })}
      <motion.circle cx={cx} cy={cy} r="0.9" fill="#10b981" animate={{ opacity: [1, 0.35, 1] }} transition={{ duration: 2, repeat: Infinity }} />
      <motion.circle cx={cx} cy={cy} r={1} fill="none" stroke="#10b981" strokeWidth="0.15" animate={{ r: [1, 5], opacity: [0.7, 0] }} transition={{ duration: 2.6, repeat: Infinity }} />
    </svg>
  );
}
