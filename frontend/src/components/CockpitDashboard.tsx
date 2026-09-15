import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ShieldCheck, AlertTriangle, XCircle, Battery as BatteryIcon, Sun,
  Satellite, CloudSun, Flame, Wifi, WifiOff, Lightbulb,
} from 'lucide-react';
import { GlassCard, CardHeader } from '@/components/primitives/GlassCard';
import { StatusPill } from '@/components/primitives/StatusPill';
import { api } from '@/lib/api';
import {
  useBattery, useSolar, useEnergy, useEnvironment, useWeather, useConnectivity,
  useConnected, useSparkBuffer,
} from '@/lib/telemetry';
import { fmtVolt, fmtWatt, fmtTemp, fmtPct, DASH } from '@/lib/format';
import type { BatteryPayload, SolarPayload } from '@/lib/types';

/** Mission-brief status -> the one dominant verdict at the top of the
 *  page. Wording is the operational question a van owner actually asks
 *  ("is the van OK?"), not the raw colour name. The colour still comes
 *  straight from the brief - no new health logic here, and none
 *  wanted: the intelligence engine owns that judgement and this screen
 *  must not invent a second opinion. */
const STATUS_META = {
  green: { tone: 'green' as const, label: 'READY', icon: ShieldCheck, cls: 'text-status-green' },
  amber: { tone: 'amber' as const, label: 'ATTENTION', icon: AlertTriangle, cls: 'text-status-amber' },
  red: { tone: 'red' as const, label: 'CRITICAL', icon: XCircle, cls: 'text-status-red' },
};

function Band({ index, className, children }: { index: number; className?: string; children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
      className={`min-h-0 ${className ?? ''}`}
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

/** Fills its container width, unlike the fixed-size Sparkline
 *  primitive - these sit at the bottom of cards whose width is set by
 *  the grid, not by us. */
function MiniSpark({ data, stroke, minRange }: { data: number[]; stroke: string; minRange: number }) {
  if (data.length < 2) return <div className="h-full min-h-[14px]" />;
  const lo = Math.min(...data);
  const hi = Math.max(...data);
  const span = Math.max(minRange, hi - lo);
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * 280},${36 - Math.min(34, Math.max(2, ((v - lo) / span) * 34))}`)
    .join(' ');
  return (
    <svg width="100%" height="100%" viewBox="0 0 280 36" preserveAspectRatio="none" aria-hidden="true" className="min-h-[14px]">
      <polyline fill="none" stroke={stroke} strokeWidth="2" points={pts} />
    </svg>
  );
}

/**
 * VanOS Home - a campervan cockpit, not a telemetry wall.
 *
 * Reading order, deliberate and in this order (Andrew, 16 Sep):
 *   STATUS -> CAMERA -> POWER -> INTELLIGENCE -> SUPPORTING TELEMETRY
 *
 * The camera is the VISUAL CENTREPIECE, not one card among equals: it
 * takes ~58% of the content width and the full height of the
 * Battery+Solar stack beside it. "What's actually happening around the
 * van" outranks every number on the page except "is the van OK".
 * Edge-to-edge image, no card chrome, just a LIVE pill and a
 * timestamp. Earlier versions put it in an equal-thirds row and it
 * read as an afterthought.
 *
 * Net energy is folded INTO the battery card rather than taking a
 * third equal card - it is a property of the power system, and
 * "+46 W, making more than using" belongs next to the battery it is
 * charging.
 *
 * Explicitly NOT a 3x3 grid of equal cards. Hierarchy is the design.
 *
 * Fits one viewport - no scrolling (that was the complaint that killed
 * the previous version). 100vh minus NavShell's chrome, rows sharing
 * the remainder by ratio, min-h-0 threaded through every level so a
 * tall card can't push the page past its own height.
 *
 * THE RULE THIS SCREEN IS BUILT AROUND: it must never imply a state
 * the hardware cannot verify. No "lighting: all off" - relay state is
 * commanded, not measured. Connectivity is labelled "Pi <-> Router",
 * not "signal" - nothing here reads the 4G modem. Heater fuel says
 * "estimated". Anything added later must pass the same test.
 */
export function CockpitDashboard() {
  const { data: brief } = useQuery({ queryKey: ['mission-brief'], queryFn: api.missionBrief, refetchInterval: 30_000 });
  const battery = useBattery();
  const solar = useSolar();
  const energy = useEnergy();
  const env = useEnvironment();
  const weather = useWeather();
  const net = useConnectivity();
  const connected = useConnected();
  const now = useClock();

  const loc = useQuery({ queryKey: ['location'], queryFn: api.location, retry: false });
  const heater = useQuery({ queryKey: ['heater'], queryFn: api.heater, refetchInterval: 5_000, retry: false });
  const fuel = useQuery({ queryKey: ['heater-fuel'], queryFn: api.heaterFuel, refetchInterval: 60_000, retry: false });

  const solarSeries = useSparkBuffer<SolarPayload>('solar', (p) => p.watts);
  const voltSeries = useSparkBuffer<BatteryPayload>('battery', (p) => p.voltage);

  const meta = STATUS_META[brief?.status ?? 'green'];
  const StatusIcon = meta.icon;

  const bp = battery.payload;
  // Resting is a real third state (a fitted shunt reporting ~0 A), not
  // a gap in the data, so it gets said rather than defaulting to
  // "discharging".
  const batteryState = bp == null
    ? DASH
    : bp.charging
      ? 'Charging'
      : bp.current_a != null && Math.abs(bp.current_a) < 0.2
        ? 'Resting'
        : 'Discharging';
  const netW = energy.payload?.net_watts ?? null;

  const ratio = weather.payload?.tomorrow_vs_today_radiation_ratio ?? null;

  const hs = heater.data?.state ?? {};
  const heaterOn = hs.state === 0x8 || Boolean(hs.igniting);
  const heaterLabel = !heater.data?.available
    ? 'No signal'
    : hs.error_code
      ? 'Fault'
      : hs.igniting
        ? 'Igniting'
        : hs.cooling_down
          ? 'Cooling down'
          : heaterOn
            ? 'Heating'
            : 'Off';

  const topRec = brief?.recommendations?.[0];
  const topPred = brief?.predictions?.[0];

  return (
    <div
      className="grid gap-4"
      style={{ height: 'calc(100vh - 12.5rem)', gridTemplateRows: 'auto minmax(0,1fr) auto auto' }}
    >
      {/* ── 1. STATUS — is the van OK? ── */}
      <Band index={0}>
        <Link to="/overview" className="block">
          <GlassCard level="hero" glow={brief?.status === 'red' ? undefined : 'teal'} className="hover:ring-white/20 transition-all">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
              <div className="flex items-center gap-4 min-w-0 flex-1">
                <StatusIcon size={36} className={`${meta.cls} shrink-0`} />
                <div className="min-w-0">
                  <div className={`text-2xl font-bold tracking-tight leading-tight ${meta.cls}`}>{meta.label}</div>
                  <div className="text-sm text-ink-soft line-clamp-1">{brief?.summary || 'Assembling mission brief…'}</div>
                </div>
              </div>
              <div className="flex items-center gap-6 shrink-0">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-ink-muted flex items-center gap-1.5">
                    <Satellite size={11} /> GPS
                  </div>
                  <div className="text-sm font-medium mt-0.5">
                    {loc.data?.satellites != null ? `${loc.data.satellites} sats` : DASH}
                    {loc.data?.hdop != null && <span className="text-ink-faint"> · {loc.data.hdop.toFixed(1)}</span>}
                  </div>
                </div>
                <div>
                  {/* The Pi <-> router link, NOT mobile signal - nothing
                      in this app reads the 4G modem, and calling this
                      "signal" would be inventing telemetry. */}
                  <div className="text-[10px] uppercase tracking-wider text-ink-muted flex items-center gap-1.5">
                    {net.payload?.online ? <Wifi size={11} /> : <WifiOff size={11} />} Pi ↔ Router
                  </div>
                  <div className="text-sm font-medium mt-0.5">
                    {net.payload?.online ? (net.payload.ssid || 'Connected') : 'Offline'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-ink-muted">Time</div>
                  <div className="num text-sm font-medium mt-0.5">
                    {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <StatusPill tone={connected ? 'teal' : 'red'}>{connected ? 'LIVE' : 'OFFLINE'}</StatusPill>
              </div>
            </div>
          </GlassCard>
        </Link>
      </Band>

      {/* ── 2. CAMERA (centrepiece) + 3. POWER ── */}
      <Band index={1} className="grid gap-4" >
        <div className="grid gap-4 min-h-0" style={{ gridTemplateColumns: 'minmax(0,42fr) minmax(0,58fr)' }}>
          {/* Power column: battery over solar, net energy folded in */}
          <div className="grid grid-rows-2 gap-4 min-h-0">
            <Link to="/power" className="block min-h-0">
              <GlassCard level="hero" glow="teal" className="h-full min-h-0 overflow-hidden flex flex-col hover:ring-white/20 transition-all">
                <CardHeader label="Battery" right={<BatteryIcon size={16} className="text-aurora-teal" />} />
                <div className="flex items-baseline gap-3">
                  <span className="num font-bold text-[clamp(1.6rem,3.4vh,2.4rem)] leading-none">
                    {bp?.soc_pct != null ? `${Math.round(bp.soc_pct)}%` : DASH}
                  </span>
                  <span className="num text-ink-soft text-[clamp(0.85rem,1.6vh,1.1rem)]">{fmtVolt(bp?.voltage)}</span>
                </div>
                {bp?.soc_pct != null && (
                  <div className="h-1.5 rounded-full bg-white/10 overflow-hidden mt-2.5">
                    <div
                      className={`h-full rounded-full transition-[width] duration-700 ${
                        bp.soc_pct < 50 ? 'bg-status-red' : bp.soc_pct < 70 ? 'bg-status-amber' : 'bg-status-green'
                      }`}
                      style={{ width: `${Math.max(2, Math.min(100, bp.soc_pct))}%` }}
                    />
                  </div>
                )}
                {/* Net energy lives here rather than in a card of its
                    own: it is a property of the power system, and the
                    answer to "am I making more than I'm using" belongs
                    beside the battery it is charging. */}
                <div className="flex items-baseline justify-between gap-3 mt-2.5">
                  <span className="text-[11px] text-ink-soft truncate">
                    {batteryState}
                    {bp?.charging_power_w != null && <span className="text-ink-faint"> · {fmtWatt(bp.charging_power_w)} in</span>}
                  </span>
                  {netW != null && (
                    <span
                      className={`num text-sm font-semibold shrink-0 ${
                        netW > 0 ? 'text-status-green' : netW < 0 ? 'text-status-amber' : ''
                      }`}
                    >
                      {netW > 0 ? '+' : ''}{fmtWatt(netW)} net
                    </span>
                  )}
                </div>
                {netW != null && (
                  <div className="text-[10px] text-ink-faint mt-0.5 truncate">
                    {netW > 0 ? 'Making more than using' : netW < 0 ? 'Using more than making' : 'Balanced'}
                    <span> · in {fmtWatt(energy.payload?.solar_watts)}, out {fmtWatt(energy.payload?.load_watts)}</span>
                  </div>
                )}
                <div className="mt-auto pt-2 min-h-0 flex-1 flex items-end">
                  <MiniSpark data={voltSeries} stroke="#22d3ee" minRange={0.4} />
                </div>
              </GlassCard>
            </Link>

            <Link to="/weather" className="block min-h-0">
              <GlassCard level="hero" className="h-full min-h-0 overflow-hidden flex flex-col hover:ring-white/20 transition-all">
                <CardHeader label="Solar" right={<Sun size={16} className="text-brand-orange" />} />
                <div className="num font-bold text-[clamp(1.6rem,3.4vh,2.4rem)] leading-none">{fmtWatt(solar.payload?.watts)}</div>
                <div className="text-[11px] text-ink-soft mt-2.5 truncate">
                  Peak today {fmtWatt(solar.payload?.peak_today_watts)}
                  <span className="text-ink-faint"> · {(solar.payload?.charge_state || 'off').toUpperCase()}</span>
                </div>
                {ratio != null && (
                  <div className="text-[10px] text-ink-faint mt-1 truncate">
                    Tomorrow {ratio >= 1 ? '↑' : '↓'} {Math.round(ratio * 100)}% of today's radiation
                  </div>
                )}
                <div className="mt-auto pt-2 min-h-0 flex-1 flex items-end">
                  <MiniSpark data={solarSeries} stroke="#FF8A00" minRange={25} />
                </div>
              </GlassCard>
            </Link>
          </div>

          {/* The centrepiece. Edge-to-edge, almost no chrome. */}
          <Link to="/camera" className="block min-h-0">
            <GlassCard className="h-full min-h-0 p-0 overflow-hidden relative hover:ring-white/25 transition-all">
              <img
                src={api.cameraSnapshotUrl(Math.floor(now.getTime() / 5000) * 5000)}
                alt="Van camera"
                className="absolute inset-0 w-full h-full object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-black/40 backdrop-blur-sm px-2.5 py-1">
                <span className="h-1.5 w-1.5 rounded-full bg-status-red shadow-[0_0_8px_rgba(239,68,68,0.9)] animate-live-pulse" />
                <span className="text-[10px] uppercase tracking-[0.18em] text-white/85">Live</span>
              </div>
              <div className="absolute bottom-3 right-3 num text-[11px] text-white/70" style={{ textShadow: '0 2px 8px rgba(0,0,0,.8)' }}>
                {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>
            </GlassCard>
          </Link>
        </div>
      </Band>

      {/* ── 4. INTELLIGENCE — one strip, not a full card ── */}
      <Band index={2}>
        <Link to="/overview" className="block">
          <GlassCard glow="purple" className="overflow-hidden hover:ring-aurora-purple/40 transition-all">
            <div className="flex items-center gap-4">
              <Lightbulb size={18} className="text-aurora-purple shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-wider text-aurora-purple font-semibold">
                  {topRec ? 'Recommended' : "Today's brief"}
                </div>
                <div className="text-sm mt-0.5 line-clamp-1">{topRec || brief?.summary || 'Assembling mission brief…'}</div>
              </div>
              {topPred && (
                <div className="shrink-0 text-right">
                  <div className="text-[10px] uppercase tracking-wider text-ink-muted">{topPred.label}</div>
                  <div className="num text-base font-semibold">
                    {topPred.value == null ? DASH : `${topPred.value}${topPred.unit ? ` ${topPred.unit}` : ''}`}
                  </div>
                </div>
              )}
            </div>
          </GlassCard>
        </Link>
      </Band>

      {/* ── 5. SUPPORTING TELEMETRY ── */}
      <Band index={3} className="grid grid-cols-3 gap-4">
        <Link to="/weather" className="block">
          <GlassCard level="quiet" className="overflow-hidden hover:ring-white/15 transition-colors">
            <CardHeader label="Environment" right={<CloudSun size={14} className="text-brand-orange" />} className="mb-2" />
            <div className="flex items-baseline gap-4">
              <div>
                <div className="num text-lg font-semibold leading-none">{fmtTemp(env.payload?.internal_temp_c)}</div>
                <div className="text-[10px] text-ink-muted mt-0.5">inside</div>
              </div>
              <div>
                <div className="num text-lg font-semibold leading-none">{fmtTemp(env.payload?.external_temp_c)}</div>
                <div className="text-[10px] text-ink-muted mt-0.5">outside</div>
              </div>
              <div className="ml-auto text-right min-w-0">
                <div className="num text-sm text-ink-soft leading-none">{fmtTemp(weather.payload?.current_temp_c)}</div>
                <div className="text-[10px] text-ink-muted mt-0.5 truncate">{weather.payload?.current_weather_description || 'no reading'}</div>
              </div>
            </div>
          </GlassCard>
        </Link>

        <Link to="/heater" className="block">
          <GlassCard level="quiet" className="overflow-hidden hover:ring-white/15 transition-colors">
            <CardHeader label="Heater" right={<Flame size={14} className={heaterOn ? 'text-brand-orange' : 'text-ink-muted'} />} className="mb-2" />
            <div className="flex items-baseline gap-3">
              <StatusPill tone={hs.error_code ? 'red' : heaterOn ? 'amber' : 'slate'}>{heaterLabel}</StatusPill>
              <span className="num text-lg font-semibold">{hs.target != null ? `${hs.target}${hs.mode === 2 ? '°C' : ''}` : DASH}</span>
              {/* Fuel is ESTIMATED from run time - there is no tank
                  sender - and is labelled so, same as the API does. */}
              {fuel.data?.tank_remaining_litres != null && fuel.data.tank_litres != null && (
                <span className="ml-auto text-[10px] text-ink-faint shrink-0">
                  fuel ~{fmtPct((fuel.data.tank_remaining_litres / fuel.data.tank_litres) * 100)}
                </span>
              )}
            </div>
            <div className="text-[10px] text-ink-faint mt-1 truncate">
              Body {fmtTemp(hs.body_temperature_c)} · Cabin {fmtTemp(hs.cabin_temperature_c)}
            </div>
          </GlassCard>
        </Link>

        <Link to="/nearby" className="block">
          <GlassCard level="quiet" className="overflow-hidden hover:ring-white/15 transition-colors">
            <CardHeader label="Location" right={<Satellite size={14} className="text-status-green" />} className="mb-2" />
            <div className="flex items-baseline gap-2">
              <span className="num text-lg font-semibold">{loc.data?.satellites ?? DASH}</span>
              <span className="text-[11px] text-ink-soft">
                satellites{loc.data?.hdop != null && <span className="text-ink-faint"> · HDOP {loc.data.hdop.toFixed(1)}</span>}
              </span>
            </div>
            {loc.data?.latitude != null && loc.data?.longitude != null && (
              <div className="num text-[10px] text-ink-faint mt-1 truncate">
                {loc.data.latitude.toFixed(4)}°, {loc.data.longitude.toFixed(4)}°
              </div>
            )}
          </GlassCard>
        </Link>
      </Band>
    </div>
  );
}
