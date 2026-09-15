import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ShieldCheck, AlertTriangle, XCircle, Battery as BatteryIcon, Sun, Thermometer, Zap,
  Satellite, CloudSun, Flame, Wifi, WifiOff, Lightbulb, ArrowRight,
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
 *  page. Wording is deliberately the operational question a van owner
 *  actually asks ("is the van OK?"), not the raw colour name. The
 *  colour still comes straight from the brief - no new health logic
 *  here, and none wanted: the intelligence engine already owns that
 *  judgement and this screen must not invent a second opinion. */
const STATUS_META = {
  green: { tone: 'green' as const, label: 'READY', icon: ShieldCheck, cls: 'text-status-green' },
  amber: { tone: 'amber' as const, label: 'ATTENTION', icon: AlertTriangle, cls: 'text-status-amber' },
  red: { tone: 'red' as const, label: 'CRITICAL', icon: XCircle, cls: 'text-status-red' },
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.18em] text-ink-muted mb-3">{title}</div>
      {children}
    </div>
  );
}

function Tile({ index, children }: { index: number; children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
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

/** Tiny inline sparkline. Kept local rather than reaching for the
 *  Sparkline primitive because this one has to stretch to the card
 *  width (preserveAspectRatio="none") rather than render at a fixed
 *  pixel size. */
function MiniSpark({ data, stroke, minRange }: { data: number[]; stroke: string; minRange: number }) {
  if (data.length < 2) return <div className="h-9" />;
  const lo = Math.min(...data);
  const hi = Math.max(...data);
  const span = Math.max(minRange, hi - lo);
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * 280},${36 - Math.min(34, Math.max(2, ((v - lo) / span) * 34))}`)
    .join(' ');
  return (
    <svg width="100%" height="36" viewBox="0 0 280 36" preserveAspectRatio="none" aria-hidden="true">
      <polyline fill="none" stroke={stroke} strokeWidth="2" points={pts} />
    </svg>
  );
}

/**
 * VanOS Home - a control centre, not a telemetry wall.
 *
 * Rebuilt 16 Sep. The previous version was nine equally-weighted cards
 * that answered "here are nine things producing numbers". This one is
 * organised around "is my van OK, and what do I need to know right
 * now?", in deliberate layers: one dominant verdict, then POWER (the
 * system that actually matters off-grid), then environment + the
 * intelligence engine's own advice, then situational awareness.
 *
 * Hierarchy is carried by the EXISTING GlassCard levels (hero /
 * standard / quiet) rather than a new component system - the repo
 * already defines those surfaces deliberately.
 *
 * THE RULE THIS SCREEN IS BUILT AROUND: it must never imply a state
 * the hardware cannot verify. That is why there is no "Lighting - all
 * off" status row here, however natural it looks on a van dashboard:
 * lighting is a relay, relay state is COMMANDED not measured (the wall
 * switches flip the same circuits with no sense line back), and a
 * green dot asserting "all off" would be inventing telemetry. Quick
 * controls may fire actions; they may not report state. Anything added
 * here later must pass the same test.
 *
 * Everything rendered below comes from a real source already in this
 * repo. Nothing invented: no water tanks, no fridge probe, no
 * maintenance schedule, no lighting state.
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
  // "Charging / discharging / resting" - resting is a real third state
  // (a fitted shunt reporting ~0 A), not a gap in the data, so it gets
  // said rather than defaulting to "discharging".
  const batteryState = bp == null
    ? DASH
    : bp.charging
      ? 'Charging'
      : bp.current_a != null && Math.abs(bp.current_a) < 0.2
        ? 'Resting'
        : 'Discharging';
  const mins = bp?.time_remaining_mins ?? null;
  const timeRemaining = mins == null ? null : `${Math.floor(mins / 60)}h ${mins % 60}m remaining`;

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
    <div className="space-y-8">
      {/* ── Status band: one dominant answer to "how is the van?" ── */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
        <Link to="/overview" className="block">
          <GlassCard level="hero" glow={brief?.status === 'red' ? undefined : 'teal'} className="hover:ring-white/20 transition-all">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
              <div className="flex items-center gap-4 min-w-0 flex-1">
                <StatusIcon size={40} className={meta.cls} />
                <div className="min-w-0">
                  <div className={`text-3xl font-bold tracking-tight ${meta.cls}`}>{meta.label}</div>
                  <div className="text-sm text-ink-soft mt-0.5 line-clamp-2">
                    {brief?.summary || 'Assembling mission brief…'}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-6 shrink-0">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-ink-muted flex items-center gap-1.5">
                    <Satellite size={11} /> GPS
                  </div>
                  <div className="text-sm font-medium mt-0.5">
                    {loc.data?.satellites != null ? `${loc.data.satellites} sats` : DASH}
                    {loc.data?.hdop != null && <span className="text-ink-faint"> · HDOP {loc.data.hdop.toFixed(1)}</span>}
                  </div>
                </div>

                <div>
                  {/* Explicitly the Pi <-> router link, not mobile signal.
                      Nothing in this app reads the 4G modem; labelling
                      this "signal" would be the same invented-telemetry
                      mistake the rest of the screen avoids. */}
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
      </motion.div>

      {/* ── Power: the system that actually matters off-grid ── */}
      <Section title="Power">
        <div className="grid grid-cols-3 gap-5 items-start">
          <Tile index={0}>
            <Link to="/power" className="block">
              <GlassCard level="hero" glow="teal" className="min-h-[300px] flex flex-col hover:ring-white/20 transition-all">
                <CardHeader label="Battery" right={<BatteryIcon size={16} className="text-aurora-teal" />} />
                <div className="flex items-baseline gap-3">
                  <span className="num text-5xl font-bold">{bp?.soc_pct != null ? `${Math.round(bp.soc_pct)}%` : DASH}</span>
                  <span className="num text-xl text-ink-soft">{fmtVolt(bp?.voltage)}</span>
                </div>
                {bp?.soc_pct != null && (
                  <div className="h-2 rounded-full bg-white/10 overflow-hidden mt-3">
                    <div
                      className={`h-full rounded-full transition-[width] duration-700 ${
                        bp.soc_pct < 50 ? 'bg-status-red' : bp.soc_pct < 70 ? 'bg-status-amber' : 'bg-status-green'
                      }`}
                      style={{ width: `${Math.max(2, Math.min(100, bp.soc_pct))}%` }}
                    />
                  </div>
                )}
                <div className="text-sm text-ink-soft mt-3">
                  {batteryState}
                  {bp?.charging_power_w != null && <span className="text-ink-faint"> · {fmtWatt(bp.charging_power_w)} in</span>}
                </div>
                {timeRemaining && <div className="text-[11px] text-ink-faint mt-1">{timeRemaining}</div>}
                <div className="mt-auto pt-3"><MiniSpark data={voltSeries} stroke="#22d3ee" minRange={0.4} /></div>
              </GlassCard>
            </Link>
          </Tile>

          <Tile index={1}>
            <Link to="/weather" className="block">
              <GlassCard level="hero" className="min-h-[300px] flex flex-col hover:ring-white/20 transition-all">
                <CardHeader label="Solar" right={<Sun size={16} className="text-brand-orange" />} />
                <div className="num text-5xl font-bold">{fmtWatt(solar.payload?.watts)}</div>
                <div className="text-sm text-ink-soft mt-3">
                  Peak today {fmtWatt(solar.payload?.peak_today_watts)}
                </div>
                <div className="text-[11px] text-ink-faint mt-1">{(solar.payload?.charge_state || 'off').toUpperCase()}</div>
                {ratio != null && (
                  <div className="text-[11px] text-ink-faint mt-2">
                    Tomorrow {ratio >= 1 ? '↑' : '↓'} {Math.round(ratio * 100)}% of today's radiation
                  </div>
                )}
                <div className="mt-auto pt-3"><MiniSpark data={solarSeries} stroke="#FF8A00" minRange={25} /></div>
              </GlassCard>
            </Link>
          </Tile>

          <Tile index={2}>
            <Link to="/power" className="block">
              <GlassCard level="hero" className="min-h-[300px] flex flex-col hover:ring-white/20 transition-all">
                <CardHeader label="Net energy" hint="solar − load" right={<Zap size={16} className="text-aurora-teal" />} />
                {/* The question this answers: am I making more than I'm
                    using? Sign carries that, so it's stated rather than
                    left for the reader to infer from a bare number. */}
                <div
                  className={`num text-5xl font-bold ${
                    energy.payload?.net_watts == null
                      ? ''
                      : energy.payload.net_watts > 0
                        ? 'text-status-green'
                        : energy.payload.net_watts < 0
                          ? 'text-status-amber'
                          : ''
                  }`}
                >
                  {energy.payload?.net_watts == null
                    ? DASH
                    : `${energy.payload.net_watts > 0 ? '+' : ''}${fmtWatt(energy.payload.net_watts)}`}
                </div>
                {energy.payload?.net_watts != null && (
                  <div className="text-sm text-ink-soft mt-3">
                    {energy.payload.net_watts > 0
                      ? 'Making more than using'
                      : energy.payload.net_watts < 0
                        ? 'Using more than making'
                        : 'Balanced'}
                  </div>
                )}
                <div className="text-[11px] text-ink-faint mt-2">
                  in {fmtWatt(energy.payload?.solar_watts)} · out {fmtWatt(energy.payload?.load_watts)}
                </div>
              </GlassCard>
            </Link>
          </Tile>
        </div>
      </Section>

      {/* ── Environment + the engine's own advice ── */}
      <div className="grid grid-cols-3 gap-5 items-start">
        <div className="col-span-1">
          <Section title="Environment">
            <Tile index={3}>
              <Link to="/weather" className="block">
                <GlassCard className="min-h-[220px] flex flex-col hover:ring-white/20 transition-all">
                  <CardHeader label="Weather" right={<CloudSun size={16} className="text-brand-orange" />} />
                  <div className="num text-4xl font-bold">{fmtTemp(weather.payload?.current_temp_c)}</div>
                  <div className="text-sm text-ink-soft mt-1 line-clamp-1">
                    {weather.payload?.current_weather_description || 'No reading yet'}
                  </div>
                  <div className="flex gap-6 mt-auto pt-4 border-t border-ink/10">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-ink-muted flex items-center gap-1">
                        <Thermometer size={10} /> Inside
                      </div>
                      <div className="num text-2xl font-semibold">{fmtTemp(env.payload?.internal_temp_c)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-ink-muted">Outside</div>
                      <div className="num text-2xl font-semibold">{fmtTemp(env.payload?.external_temp_c)}</div>
                    </div>
                  </div>
                </GlassCard>
              </Link>
            </Tile>
          </Section>
        </div>

        <div className="col-span-2">
          <Section title="What you need to know">
            <Tile index={4}>
              <Link to="/overview" className="block">
                <GlassCard level="hero" glow="purple" className="min-h-[220px] flex flex-col hover:ring-aurora-purple/40 transition-all">
                  <CardHeader label="Today's brief" hint="from the intelligence engine" right={<Lightbulb size={16} className="text-aurora-purple" />} />
                  <div className="text-base text-ink-soft line-clamp-2">{brief?.summary || 'Assembling mission brief…'}</div>

                  {topRec && (
                    <div className="mt-4 rounded-xl bg-aurora-purple/10 ring-1 ring-inset ring-aurora-purple/25 px-4 py-3">
                      <div className="text-[10px] uppercase tracking-wider text-aurora-purple font-semibold">Recommended</div>
                      <div className="text-sm mt-1 line-clamp-2">{topRec}</div>
                    </div>
                  )}

                  {topPred && (
                    <div className="mt-auto pt-4 flex items-end justify-between gap-4 border-t border-ink/10">
                      <div className="min-w-0">
                        <div className="text-[10px] uppercase tracking-wider text-ink-muted">{topPred.label}</div>
                        <div className="num text-2xl font-semibold">
                          {topPred.value == null ? DASH : `${topPred.value}${topPred.unit ? ` ${topPred.unit}` : ''}`}
                        </div>
                        {topPred.confidence && <div className="text-[11px] text-ink-faint mt-0.5 line-clamp-1">{topPred.confidence}</div>}
                      </div>
                      <span className="text-[11px] text-ink-faint flex items-center gap-1 shrink-0">
                        Full brief <ArrowRight size={11} />
                      </span>
                    </div>
                  )}
                </GlassCard>
              </Link>
            </Tile>
          </Section>
        </div>
      </div>

      {/* ── Situational awareness ── */}
      <Section title="Right now">
        <div className="grid grid-cols-3 gap-5 items-start">
          <Tile index={5}>
            <Link to="/camera" className="block">
              <GlassCard className="min-h-[230px] p-0 overflow-hidden relative hover:ring-white/20 transition-all">
                <img
                  src={api.cameraSnapshotUrl(Math.floor(now.getTime() / 5000) * 5000)}
                  alt="Van camera"
                  className="absolute inset-0 w-full h-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/0 to-black/30" />
                <div className="absolute top-4 left-4 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.2em] text-white/80" style={{ textShadow: '0 2px 8px rgba(0,0,0,.7)' }}>
                  <span className="h-1.5 w-1.5 rounded-full bg-status-red shadow-[0_0_8px_rgba(239,68,68,0.9)] animate-live-pulse" />
                  Live camera
                </div>
              </GlassCard>
            </Link>
          </Tile>

          <Tile index={6}>
            <Link to="/nearby" className="block">
              <GlassCard className="min-h-[230px] flex flex-col hover:ring-white/20 transition-all">
                <CardHeader label="Location" right={<Satellite size={16} className="text-status-green" />} />
                <div className="num text-4xl font-bold">{loc.data?.satellites ?? DASH}</div>
                <div className="text-sm text-ink-soft mt-1">
                  satellites{loc.data?.hdop != null && <span className="text-ink-faint"> · HDOP {loc.data.hdop.toFixed(1)}</span>}
                </div>
                {loc.data?.latitude != null && loc.data?.longitude != null && (
                  <div className="num text-[11px] text-ink-faint mt-auto pt-3">
                    {loc.data.latitude.toFixed(4)}°, {loc.data.longitude.toFixed(4)}°
                  </div>
                )}
              </GlassCard>
            </Link>
          </Tile>

          <Tile index={7}>
            <Link to="/heater" className="block">
              <GlassCard className="min-h-[230px] flex flex-col hover:ring-white/20 transition-all">
                <CardHeader
                  label="Heater"
                  right={<Flame size={16} className={heaterOn ? 'text-brand-orange' : 'text-ink-muted'} />}
                />
                <StatusPill tone={hs.error_code ? 'red' : heaterOn ? 'amber' : 'slate'}>{heaterLabel}</StatusPill>
                <div className="num text-3xl font-semibold mt-3">
                  {hs.target != null ? `${hs.target}${hs.mode === 2 ? '°C' : ''}` : DASH}
                </div>
                <div className="text-[11px] text-ink-faint mt-1">
                  Body {fmtTemp(hs.body_temperature_c)} · Cabin {fmtTemp(hs.cabin_temperature_c)}
                </div>
                {/* Fuel is an ESTIMATE from run time, never a tank
                    sender - there isn't one. Labelled as such here for
                    the same reason heater_fuel_service.py labels it in
                    the API. */}
                {fuel.data?.tank_remaining_litres != null && fuel.data.tank_litres != null && (
                  <div className="mt-auto pt-3 border-t border-ink/10">
                    <div className="text-[10px] uppercase tracking-wider text-ink-muted">Fuel · estimated</div>
                    <div className="num text-sm font-medium">
                      {fmtPct((fuel.data.tank_remaining_litres / fuel.data.tank_litres) * 100)}
                      <span className="text-ink-faint"> of tank</span>
                    </div>
                  </div>
                )}
              </GlassCard>
            </Link>
          </Tile>
        </div>
      </Section>
    </div>
  );
}
