import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ShieldCheck, AlertTriangle, XCircle, Battery as BatteryIcon, Sun, Thermometer, Zap,
  Satellite, PlugZap, CloudSun,
} from 'lucide-react';
import { GlassCard, CardHeader } from '@/components/primitives/GlassCard';
import { StatusPill } from '@/components/primitives/StatusPill';
import { api } from '@/lib/api';
import { useBattery, useSolar, useEnergy, useEnvironment, useWeather, useSparkBuffer } from '@/lib/telemetry';
import { fmtVolt, fmtWatt, fmtTemp, DASH } from '@/lib/format';
import type { BatteryPayload, SolarPayload } from '@/lib/types';

const STATUS_META = {
  green: { tone: 'green' as const, label: 'GREEN', icon: ShieldCheck },
  amber: { tone: 'amber' as const, label: 'AMBER', icon: AlertTriangle },
  red: { tone: 'red' as const, label: 'RED', icon: XCircle },
};

/**
 * Same power-on cascade as before - each tile fades/lifts in with a
 * small stagger by grid position. One-time mount animation, not tied
 * to data refetches.
 */
function Tile({ index, children }: { index: number; children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, delay: index * 0.055, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ scale: 1.012 }}
      className="h-full"
    >
      {children}
    </motion.div>
  );
}

function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useState(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  });
  return now;
}

/**
 * Rebuilt 15 Sep to an exact layout Andrew specified after several
 * guessed-at attempts didn't land - a literal 3x3 grid, every tile the
 * SAME SIZE (min-h below, not left to natural content height, so a
 * one-line reading and the camera feed occupy the same footprint), the
 * camera in the dead-centre cell:
 *
 *   Battery      Mission Brief   Solar
 *   Satellites   Camera          Charging power
 *   Energy       Weather         Temperatures
 *
 * No column ever gets a bigger span than its neighbours - that was the
 * repeated mistake in earlier attempts (camera/GPS at 7/5 or 8/4 splits
 * "to make camera the focal point"). Equal footprint for all nine,
 * position alone makes camera central.
 */
export function CockpitDashboard() {
  const { data: brief } = useQuery({ queryKey: ['mission-brief'], queryFn: api.missionBrief, refetchInterval: 30_000 });
  const battery = useBattery();
  const solar = useSolar();
  const energy = useEnergy();
  const env = useEnvironment();
  const weather = useWeather();
  const now = useClock();

  const loc = useQuery({ queryKey: ['location'], queryFn: api.location, retry: false });

  const solarSeries = useSparkBuffer<SolarPayload>('solar', (p) => p.watts);
  const voltSeries = useSparkBuffer<BatteryPayload>('battery', (p) => p.voltage);

  const meta = STATUS_META[brief?.status ?? 'green'];
  const Icon = meta.icon;
  const topPrediction = brief?.predictions?.[0];

  return (
    <div className="grid grid-cols-3 gap-5 items-start">
      {/* Row 1 - Battery/Solar bigger, matching the original hero
          sizing (16 Sep: "let's try 1" - bigger hero tiles for
          Battery/Solar/Net-energy, everything else stays compact and
          uniform). items-start on the grid lets each column size to
          its own content instead of every tile in a row being
          stretched to match its tallest neighbour. */}
      <Tile index={0}>
        <GlassCard level="hero" glow="teal" className="min-h-[320px] flex flex-col">
          <CardHeader label="Battery" right={<BatteryIcon size={16} className="text-aurora-teal" />} />
          <div className="num text-4xl font-bold">{fmtVolt(battery.payload?.voltage)}</div>
          {battery.payload?.soc_pct != null && (
            <div className="mt-2">
              <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-[width] duration-700 ${
                    battery.payload.soc_pct < 50 ? 'bg-status-red' : battery.payload.soc_pct < 70 ? 'bg-status-amber' : 'bg-status-green'
                  }`}
                  style={{ width: `${Math.max(2, Math.min(100, battery.payload.soc_pct))}%` }}
                />
              </div>
              <div className="text-[11px] text-ink-faint mt-1">{Math.round(battery.payload.soc_pct)}% state of charge</div>
            </div>
          )}
          <div className="mt-auto pt-3">
            <svg width="100%" height="36" viewBox="0 0 280 36" preserveAspectRatio="none">
              <polyline
                fill="none" stroke="#22d3ee" strokeWidth="2"
                points={voltSeries.length > 1 ? voltSeries.map((v, i) => `${(i / (voltSeries.length - 1)) * 280},${36 - Math.min(34, Math.max(2, ((v - Math.min(...voltSeries)) / Math.max(0.4, Math.max(...voltSeries) - Math.min(...voltSeries))) * 34))}`).join(' ') : ''}
              />
            </svg>
          </div>
        </GlassCard>
      </Tile>

      <Tile index={1}>
        <Link to="/overview" className="block h-full">
          <GlassCard level="hero" glow="purple" className="min-h-[240px] flex flex-col hover:ring-aurora-purple/40 transition-colors">
            <CardHeader label="Mission Brief" right={<Icon size={16} className={meta.tone === 'green' ? 'text-status-green' : meta.tone === 'amber' ? 'text-status-amber' : 'text-status-red'} />} />
            <StatusPill tone={meta.tone === 'green' ? 'teal' : meta.tone}>{meta.label}</StatusPill>
            <div className="text-sm text-ink-soft mt-3 line-clamp-3">{brief?.summary || 'Assembling mission brief…'}</div>
            {topPrediction && (
              <div className="mt-auto pt-3 border-t border-ink/10">
                <div className="text-[10px] uppercase tracking-wider text-ink-muted">{topPrediction.label}</div>
                <div className="num text-lg font-semibold">
                  {topPrediction.value == null ? DASH : `${topPrediction.value}${topPrediction.unit ? ` ${topPrediction.unit}` : ''}`}
                </div>
              </div>
            )}
          </GlassCard>
        </Link>
      </Tile>

      <Tile index={2}>
        <GlassCard level="hero" className="min-h-[320px] flex flex-col">
          <CardHeader label="Solar" right={<Sun size={16} className="text-brand-orange" />} />
          <div className="num text-4xl font-bold">{fmtWatt(solar.payload?.watts)}</div>
          <div className="text-[11px] text-ink-faint mt-1">
            Peak today {fmtWatt(solar.payload?.peak_today_watts)} · {(solar.payload?.charge_state || 'off').toUpperCase()}
          </div>
          <div className="mt-auto pt-3">
            <svg width="100%" height="36" viewBox="0 0 280 36" preserveAspectRatio="none">
              <polyline
                fill="none" stroke="#FF8A00" strokeWidth="2"
                points={solarSeries.length > 1 ? solarSeries.map((v, i) => `${(i / (solarSeries.length - 1)) * 280},${36 - Math.min(34, Math.max(2, ((v - Math.min(...solarSeries)) / Math.max(25, Math.max(...solarSeries) - Math.min(...solarSeries))) * 34))}`).join(' ') : ''}
              />
            </svg>
          </div>
        </GlassCard>
      </Tile>

      {/* Row 2 - camera dead centre, same footprint as every neighbour */}
      <Tile index={3}>
        <Link to="/nearby" className="block h-full">
          <GlassCard className="min-h-[240px] flex flex-col hover:ring-white/20 transition-all">
            <CardHeader label="Satellites" right={<Satellite size={16} className="text-status-green" />} />
            <div className="num text-4xl font-bold">{loc.data?.satellites ?? DASH}</div>
            <div className="text-[11px] text-ink-faint mt-1">
              {loc.data?.hdop != null ? `HDOP ${loc.data.hdop.toFixed(1)}` : 'Locked'}
            </div>
            {loc.data?.latitude != null && loc.data?.longitude != null && (
              <div className="text-[11px] text-ink-soft mt-auto pt-3 num">
                {loc.data.latitude.toFixed(4)}°, {loc.data.longitude.toFixed(4)}°
              </div>
            )}
          </GlassCard>
        </Link>
      </Tile>

      <Tile index={4}>
        <Link to="/camera" className="block h-full">
          <GlassCard className="min-h-[240px] p-0 overflow-hidden relative hover:ring-white/20 transition-all">
            <img
              src={api.cameraSnapshotUrl(Math.floor(now.getTime() / 5000) * 5000)}
              alt="Van camera"
              className="absolute inset-0 w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/0 to-black/30" />
            <div className="absolute top-4 left-4 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.2em] text-white/80" style={{ textShadow: '0 2px 8px rgba(0,0,0,.7)' }}>
              <span className="h-1.5 w-1.5 rounded-full bg-status-red shadow-[0_0_8px_rgba(239,68,68,0.9)] animate-live-pulse" />
              Camera
            </div>
          </GlassCard>
        </Link>
      </Tile>

      <Tile index={5}>
        <Link to="/power" className="block h-full">
          <GlassCard className="min-h-[240px] flex flex-col hover:ring-white/20 transition-all">
            <CardHeader label="Charging power" hint="MPPT → bank" right={<PlugZap size={16} className="text-aurora-teal" />} />
            <div className="num text-4xl font-bold">{fmtWatt(battery.payload?.charging_power_w)}</div>
            <div className="text-[11px] text-ink-faint mt-1">{battery.payload?.charging ? 'Charging' : 'Not charging'}</div>
          </GlassCard>
        </Link>
      </Tile>

      {/* Row 3 */}
      <Tile index={6}>
        <GlassCard level="quiet" className="min-h-[320px] flex flex-col justify-center">
          <CardHeader label="Net energy" hint="solar − load" right={<Zap size={16} className="text-aurora-teal" />} />
          <div className="num text-5xl font-bold">{fmtWatt(energy.payload?.net_watts)}</div>
          <div className="text-[11px] text-ink-faint mt-2">in {fmtWatt(energy.payload?.solar_watts)} · out {fmtWatt(energy.payload?.load_watts)}</div>
        </GlassCard>
      </Tile>

      <Tile index={7}>
        <Link to="/weather" className="block h-full">
          <GlassCard level="quiet" className="min-h-[240px] flex flex-col hover:ring-white/15 transition-colors">
            <CardHeader label="Weather" right={<CloudSun size={16} className="text-brand-orange" />} />
            <div className="num text-4xl font-bold">{fmtTemp(weather.payload?.current_temp_c)}</div>
            <div className="text-[11px] text-ink-faint mt-1 line-clamp-2">{weather.payload?.current_weather_description || 'No reading yet'}</div>
          </GlassCard>
        </Link>
      </Tile>

      <Tile index={8}>
        <Link to="/weather" className="block h-full">
          <GlassCard level="quiet" className="min-h-[240px] flex flex-col hover:ring-white/15 transition-colors">
            <CardHeader label="Temperatures" hint="1-Wire probes" right={<Thermometer size={16} className="text-aurora-teal" />} />
            <div className="flex gap-8 mt-2">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-ink-muted">Interior</div>
                <div className="num text-3xl font-semibold">{fmtTemp(env.payload?.internal_temp_c)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-ink-muted">Outside</div>
                <div className="num text-3xl font-semibold">{fmtTemp(env.payload?.external_temp_c)}</div>
              </div>
            </div>
          </GlassCard>
        </Link>
      </Tile>
    </div>
  );
}
