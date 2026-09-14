import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ShieldCheck, AlertTriangle, XCircle, Battery as BatteryIcon, Sun, Thermometer, Zap,
  Navigation, Mic, ArrowUpFromLine,
} from 'lucide-react';
import { GlassCard, CardHeader } from '@/components/primitives/GlassCard';
import { SatelliteSky } from '@/components/SatelliteSky';
import { StatusPill } from '@/components/primitives/StatusPill';
import { GaugeRing } from '@/components/primitives/GaugeRing';
import { Sparkline } from '@/components/primitives/Sparkline';
import { HeaterGraphic } from '@/components/HeaterGraphic';
import { api } from '@/lib/api';
import { useBattery, useSolar, useEnergy, useEnvironment, useSparkBuffer, useConnected } from '@/lib/telemetry';
import { fmtVolt, fmtWatt, fmtTemp, DASH } from '@/lib/format';
import type { BatteryPayload, SolarPayload } from '@/lib/types';

const STATUS_META = {
  green: { tone: 'green' as const, label: 'GREEN', icon: ShieldCheck },
  amber: { tone: 'amber' as const, label: 'AMBER', icon: AlertTriangle },
  red: { tone: 'red' as const, label: 'RED', icon: XCircle },
};

function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useState(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  });
  return now;
}

/**
 * The "show it off" dashboard: everything Home.tsx already tracks
 * (battery/solar/energy/weather/GPS/mission brief - same hooks, same
 * components, not re-fetched or re-implemented) PLUS the three live
 * domains Home never surfaced at all - heater, roof, voice - laid out
 * densely for a tablet or laptop propped up at a meet rather than
 * scrolled through on a phone. Auto-activated by useIsWideScreen, not
 * a separate route: the same van, the same data, just more of it
 * visible at once on a bigger screen.
 *
 * The brief was explicitly "animated" (this is for showing off, not
 * just for use) - real state changes get real motion here in a way
 * Home.tsx's own components already support but this screen leans on
 * harder: HeaterGraphic's flame/fan genuinely animate with the real
 * state, the mic pulses only while Ron is actually listening, and the
 * background AuroraBackground (already global, behind every screen)
 * provides the ambient motion. No new decoration invented for this -
 * every animated thing here is animating something TRUE (a real
 * reading, a real state), which matters on an app whose whole ethos is
 * refusing to fake a number.
 */
export function CockpitDashboard() {
  const { data: brief } = useQuery({ queryKey: ['mission-brief'], queryFn: api.missionBrief, refetchInterval: 30_000 });
  const battery = useBattery();
  const solar = useSolar();
  const energy = useEnergy();
  const env = useEnvironment();
  const connected = useConnected();
  const now = useClock();

  const loc = useQuery({ queryKey: ['location'], queryFn: api.location, retry: false });
  const heater = useQuery({ queryKey: ['heater'], queryFn: api.heater, refetchInterval: 2_000, retry: false });
  const roof = useQuery({ queryKey: ['roof'], queryFn: api.roofStatus, refetchInterval: 3_000, retry: false });
  const voice = useQuery({ queryKey: ['voice-control-status'], queryFn: api.voiceControlStatus, refetchInterval: 3_000, retry: false });

  const solarSeries = useSparkBuffer<SolarPayload>('solar', (p) => p.watts);
  const voltSeries = useSparkBuffer<BatteryPayload>('battery', (p) => p.voltage);

  const meta = STATUS_META[brief?.status ?? 'green'];
  const Icon = meta.icon;

  const hs = heater.data?.state ?? {};
  const heaterHeating = hs.state === 0x8 || Boolean(hs.igniting);
  const heaterVentilating = Boolean(hs.ventilating) || hs.state === 0xc;
  const heaterGraphicMode: 'off' | 'blowing' | 'igniting' | 'heating' | 'cooldown' | 'fault' = hs.error_code
    ? 'fault'
    : hs.igniting
      ? 'igniting'
      : hs.cooling_down
        ? 'cooldown'
        : heaterHeating
          ? 'heating'
          : heaterVentilating
            ? 'blowing'
            : 'off';
  const heaterLabel = !heater.data?.available
    ? 'No signal'
    : hs.error_code
      ? 'Fault'
      : heaterGraphicMode === 'heating'
        ? 'Heating'
        : heaterGraphicMode === 'igniting'
          ? 'Igniting'
          : heaterGraphicMode === 'cooldown'
            ? 'Cooling down'
            : heaterGraphicMode === 'blowing'
              ? 'Ventilating'
              : 'Off';

  const roofMoving = roof.data?.moving ?? null;

  return (
    <div className="relative">
      <div className="grid grid-cols-12 gap-5">
        {/* Hero strip */}
        <GlassCard level="hero" glow="teal" className="col-span-3">
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
          <div className="mt-3"><Sparkline data={voltSeries} width={280} height={48} stroke="#22d3ee" fill="rgba(34,211,238,0.25)" minRange={0.4} /></div>
        </GlassCard>

        <GlassCard level="hero" className="col-span-3">
          <CardHeader label="Solar" right={<Sun size={16} className="text-brand-orange" />} />
          <div className="num text-4xl font-bold">{fmtWatt(solar.payload?.watts)}</div>
          <div className="text-[11px] text-ink-faint mt-1">
            Peak today {fmtWatt(solar.payload?.peak_today_watts)} · {(solar.payload?.charge_state || 'off').toUpperCase()}
          </div>
          <div className="mt-3"><Sparkline data={solarSeries} width={280} height={48} stroke="#FF8A00" fill="rgba(255,138,0,0.22)" minRange={25} /></div>
        </GlassCard>

        <GlassCard level="hero" className="col-span-3">
          <CardHeader label="Net energy" hint="solar − load" right={<Zap size={16} className="text-aurora-teal" />} />
          <div className="num text-4xl font-bold">{fmtWatt(energy.payload?.net_watts)}</div>
          <div className="text-[11px] text-ink-faint mt-2">in {fmtWatt(energy.payload?.solar_watts)} · out {fmtWatt(energy.payload?.load_watts)}</div>
          <div className="flex gap-4 mt-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ink-muted">Inside</div>
              <div className="num text-xl font-semibold">{fmtTemp(env.payload?.internal_temp_c)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ink-muted">Outside</div>
              <div className="num text-xl font-semibold">{fmtTemp(env.payload?.external_temp_c)}</div>
            </div>
          </div>
        </GlassCard>

        <GlassCard level="hero" glow="purple" className="col-span-3 relative overflow-hidden">
          <CardHeader label="Status" />
          <div className="flex items-center gap-3 mt-1">
            <GaugeRing tone={meta.tone} size={52} progress={meta.tone === 'green' ? 1 : meta.tone === 'amber' ? 0.6 : 0.3}>
              <Icon size={20} className={meta.tone === 'green' ? 'text-status-green' : meta.tone === 'amber' ? 'text-status-amber' : 'text-status-red'} />
            </GaugeRing>
            <div className="min-w-0 flex-1">
              <StatusPill tone={connected ? 'teal' : 'red'}>{connected ? 'LIVE' : 'OFFLINE'}</StatusPill>
              <div className="num text-2xl font-bold mt-1.5">{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
          </div>
          <Link to="/overview" className="text-xs text-ink-soft mt-3 block hover:text-aurora-teal transition-colors line-clamp-2">
            {brief?.summary || 'Assembling mission brief…'}
          </Link>
        </GlassCard>

        {/* Camera + GPS row */}
        <GlassCard className="col-span-7 p-0 overflow-hidden relative" style={{ minHeight: 260 }}>
          <img
            src={api.cameraSnapshotUrl(Math.floor(now.getTime() / 5000) * 5000)}
            alt="Van camera"
            className="absolute inset-0 w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0'; }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/0 to-black/30" />
          <div className="absolute top-4 left-4 text-[11px] uppercase tracking-[0.2em] text-white/80" style={{ textShadow: '0 2px 8px rgba(0,0,0,.7)' }}>
            Camera
          </div>
        </GlassCard>

        <GlassCard className="col-span-5 p-0 overflow-hidden relative" style={{ minHeight: 260 }}>
          <SatelliteSky className="absolute inset-0 z-0 opacity-70" />
          <div className="relative z-10 p-5">
            <div className="text-[10px] tracking-[0.25em] text-status-green uppercase font-semibold">GPS Locked</div>
            <div className="text-3xl font-bold mt-0.5">{loc.data?.satellites ?? DASH} Satellites</div>
            {loc.data?.hdop != null && <div className="text-xs text-ink-soft mt-0.5">HDOP {loc.data.hdop.toFixed(1)}</div>}
            {loc.data?.latitude != null && loc.data?.longitude != null && (
              <div className="text-xs text-ink-soft mt-3 num" style={{ textShadow: '0 2px 12px rgba(0,0,0,.6)' }}>
                {loc.data.latitude.toFixed(4)}°, {loc.data.longitude.toFixed(4)}°
              </div>
            )}
            <Link to="/nearby" className="mt-3 inline-flex items-center gap-1.5 rounded-full pl-3.5 pr-2.5 py-1.5 text-xs font-medium bg-black/50 backdrop-blur-md ring-1 ring-white/15 hover:bg-black/65">
              Navigate <Navigation size={12} />
            </Link>
          </div>
        </GlassCard>

        {/* Heater / Roof / Voice - the three domains Home.tsx never showed */}
        <GlassCard className="col-span-4">
          <CardHeader label="Diesel heater" right={<StatusPill tone={hs.error_code ? 'red' : heaterHeating ? 'amber' : 'slate'}>{heaterLabel}</StatusPill>} />
          <div className="flex items-center gap-4 mt-2">
            <HeaterGraphic mode={heaterGraphicMode} size={110} />
            <div className="min-w-0">
              <div className="num text-2xl font-semibold">{hs.target != null ? `${hs.target}${hs.mode === 2 ? '°C' : ''}` : DASH}</div>
              <div className="text-[11px] text-ink-faint mt-1">
                Body {fmtTemp(hs.body_temperature_c)} · Cabin {fmtTemp(hs.cabin_temperature_c)}
              </div>
            </div>
          </div>
        </GlassCard>

        <GlassCard className="col-span-4">
          <CardHeader label="Roof" right={<ArrowUpFromLine size={16} className={roofMoving ? 'text-aurora-teal' : 'text-ink-muted'} />} />
          <div className="flex items-center gap-3 mt-2">
            <StatusPill tone={roofMoving ? 'teal' : 'slate'}>
              {roofMoving ? `Moving ${roofMoving}` : 'Stopped'}
            </StatusPill>
          </div>
          <div className="text-[11px] text-ink-faint mt-3">
            {/* Honest by design, same as the roof screen itself: there is
                no position sensor, so this never claims "open"/"closed". */}
            No position sensor — the app only knows what it last commanded.
          </div>
        </GlassCard>

        <GlassCard className="col-span-4">
          <CardHeader
            label="Ron"
            hint={voice.data?.wake_word ? `wake word "${voice.data.wake_word}"` : undefined}
            right={<Mic size={16} className={voice.data?.listening ? 'text-aurora-purple animate-live-pulse' : 'text-ink-muted'} />}
          />
          <StatusPill tone={voice.data?.listening ? 'purple' : voice.data?.enabled ? 'slate' : 'red'}>
            {!voice.data?.enabled ? 'Disabled' : voice.data?.processing ? 'Thinking…' : voice.data?.listening ? 'Listening' : 'Idle'}
          </StatusPill>
          {voice.data?.last_command_text && (
            <div className="text-[11px] text-ink-faint mt-3 line-clamp-2">"{voice.data.last_command_text}"</div>
          )}
        </GlassCard>

        <GlassCard level="quiet" className="col-span-6" data-testid="cockpit-interior">
          <CardHeader label="Interior" hint="1-Wire probe" right={<Thermometer size={16} className="text-aurora-teal" />} />
          <div className="num text-3xl font-semibold">{fmtTemp(env.payload?.internal_temp_c)}</div>
        </GlassCard>
        <GlassCard level="quiet" className="col-span-6" data-testid="cockpit-exterior">
          <CardHeader label="Outside" hint="1-Wire probe" right={<Sun size={16} className="text-brand-orange" />} />
          <div className="num text-3xl font-semibold">{fmtTemp(env.payload?.external_temp_c)}</div>
        </GlassCard>
      </div>
    </div>
  );
}
