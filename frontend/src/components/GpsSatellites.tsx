import { useQuery } from '@tanstack/react-query';
import { Satellite } from 'lucide-react';
import { api } from '@/lib/api';
import { GlassCard, CardHeader } from '@/components/primitives/GlassCard';
import type { GpsSatellite } from '@/lib/types';

const QUALITY_FILL: Record<GpsSatellite['quality'], string> = {
  strong: 'fill-aurora-teal',
  good: 'fill-status-green',
  fair: 'fill-status-amber',
  poor: 'fill-ink-faint',
  'not tracking': 'fill-ink-faint',
};

const QUALITY_TEXT: Record<GpsSatellite['quality'], string> = {
  strong: 'text-aurora-teal',
  good: 'text-status-green',
  fair: 'text-status-amber',
  poor: 'text-ink-faint',
  'not tracking': 'text-ink-faint',
};

/** Polar sky-plot: centre = directly overhead (elevation 90 deg), edge
 *  = the horizon (elevation 0 deg). Azimuth follows compass bearing
 *  (0=N at top, clockwise) - the standard convention for this kind of
 *  chart, matching what any real GPS receiver's own sky-view shows. */
function SkyPlot({ satellites }: { satellites: GpsSatellite[] }) {
  const size = 200;
  const center = size / 2;
  const maxRadius = size / 2 - 22;

  const plottable = satellites.filter((s) => s.elevation != null && s.azimuth != null);

  const toXY = (elevation: number, azimuth: number) => {
    const r = ((90 - elevation) / 90) * maxRadius;
    const bearingRad = (azimuth * Math.PI) / 180;
    return { x: center + r * Math.sin(bearingRad), y: center - r * Math.cos(bearingRad) };
  };

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[220px] mx-auto" role="img" aria-label="GPS satellite sky-plot">
      {[0, 30, 60].map((elevation) => (
        <circle
          key={elevation}
          cx={center}
          cy={center}
          r={((90 - elevation) / 90) * maxRadius}
          fill="none"
          className="stroke-ink/15"
          strokeWidth={1}
        />
      ))}
      <line x1={center - maxRadius} y1={center} x2={center + maxRadius} y2={center} className="stroke-ink/10" strokeWidth={1} />
      <line x1={center} y1={center - maxRadius} x2={center} y2={center + maxRadius} className="stroke-ink/10" strokeWidth={1} />

      <text x={center} y={center - maxRadius - 8} textAnchor="middle" className="fill-ink-faint text-[10px]">N</text>
      <text x={center + maxRadius + 10} y={center} textAnchor="middle" dominantBaseline="middle" className="fill-ink-faint text-[10px]">E</text>
      <text x={center} y={center + maxRadius + 14} textAnchor="middle" className="fill-ink-faint text-[10px]">S</text>
      <text x={center - maxRadius - 10} y={center} textAnchor="middle" dominantBaseline="middle" className="fill-ink-faint text-[10px]">W</text>

      {plottable.map((sat) => {
        const { x, y } = toXY(sat.elevation!, sat.azimuth!);
        return (
          <circle key={`${sat.constellation}-${sat.prn}`} cx={x} cy={y} r={5} className={QUALITY_FILL[sat.quality]} opacity={0.9}>
            <title>{`${sat.constellation}${sat.prn} — ${sat.quality}${sat.snr != null ? ` (${sat.snr} dB-Hz)` : ''}`}</title>
          </circle>
        );
      })}
    </svg>
  );
}

export function GpsSatellitesCard() {
  const q = useQuery({
    queryKey: ['gps-satellites'],
    queryFn: api.gpsSatellites,
    refetchInterval: 5000,
    retry: false,
  });

  const satellites = q.data?.satellites ?? [];
  const tracked = satellites.filter((s) => s.snr != null);

  if (q.isError || satellites.length === 0) {
    return null; // No GPS plugin running, or no data yet - nothing honest to show
  }

  return (
    <GlassCard className="col-span-12 lg:col-span-5 p-6">
      <CardHeader
        label="GPS satellites"
        hint={`${satellites.length} in view, ${tracked.length} with signal`}
        right={<Satellite size={16} className="text-aurora-teal" />}
      />
      <div className="flex flex-col sm:flex-row gap-4 items-center sm:items-start">
        <SkyPlot satellites={satellites} />
        <div className="flex-1 w-full space-y-1.5">
          {satellites.slice(0, 8).map((sat) => (
            <div key={`${sat.constellation}-${sat.prn}`} className="flex items-center justify-between text-xs">
              <span className="text-ink-soft num">
                {sat.constellation}{sat.prn}
                {sat.elevation != null ? <span className="text-ink-faint"> · {sat.elevation}°</span> : null}
              </span>
              <span className={`font-medium ${QUALITY_TEXT[sat.quality]}`}>
                {sat.snr != null ? `${sat.snr} dB-Hz` : 'not tracking'}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 text-[11px] text-ink-faint">
        Real per-satellite data from the GPS receiver's own signal reports — not available from browser or IP-based location.
        This is every satellite the receiver can hear, not just the ones actually used for the fix — normal for this count to be higher than the "satellites in fix" figure on the Location card above.
      </div>
    </GlassCard>
  );
}
