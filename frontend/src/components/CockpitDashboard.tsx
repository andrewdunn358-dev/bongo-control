import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  ShieldCheck, AlertTriangle, XCircle, Battery as BatteryIcon, Sun, Thermometer, Zap,
  Mic, Power as PowerIcon, ArrowRight,
} from 'lucide-react';
import { GlassCard, CardHeader } from '@/components/primitives/GlassCard';
import { Switch } from '@/components/ui/switch';
import { SatelliteSky } from '@/components/SatelliteSky';
import { StatusPill } from '@/components/primitives/StatusPill';
import { GaugeRing } from '@/components/primitives/GaugeRing';
import { Sparkline } from '@/components/primitives/Sparkline';
import { HeaterGraphic } from '@/components/HeaterGraphic';
import { api, ApiError } from '@/lib/api';
import { useBattery, useSolar, useEnergy, useEnvironment, useSparkBuffer, useConnected } from '@/lib/telemetry';
import { fmtVolt, fmtWatt, fmtTemp, DASH } from '@/lib/format';
import type { BatteryPayload, SolarPayload } from '@/lib/types';

const STATUS_META = {
  green: { tone: 'green' as const, label: 'GREEN', icon: ShieldCheck },
  amber: { tone: 'amber' as const, label: 'AMBER', icon: AlertTriangle },
  red: { tone: 'red' as const, label: 'RED', icon: XCircle },
};

/**
 * The "power-on" cascade: each tile fades and lifts in with a small
 * stagger by index, so loading this screen in front of people reads as
 * a system coming alive rather than a page just appearing. Deliberately
 * a ONE-TIME mount animation, not a per-update effect - it plays once
 * when CockpitDashboard mounts (walking up to the tablet, unlocking
 * it), not every time a query refetches, which would be distracting
 * rather than impressive. Respects prefers-reduced-motion for free:
 * framer-motion checks it internally and skips transforms/opacity
 * animation when set, same as every other animation on this screen.
 */
function Tile({ index, className, children }: { index: number; className?: string; children: ReactNode }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 18, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, delay: index * 0.055, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ scale: 1.012 }}
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
 * The "show it off" dashboard: everything Home.tsx already tracks
 * (battery/solar/energy/GPS/mission brief - same hooks, same
 * components, not re-fetched or re-implemented) PLUS the domains Home
 * never surfaced at all - heater, voice, a relay quick-toggle strip -
 * laid out densely for a tablet or laptop propped up at a meet rather
 * than scrolled through on a phone. Auto-activated by useIsWideScreen,
 * not a separate route: the same van, the same data, just more of it
 * visible at once on a bigger screen.
 *
 * Every tile that has a real screen behind it is a Link to that screen
 * (first real-hardware pass, 14 Sep, had none of these - "nothing is
 * clickable"). The relay strip is the one exception: it acts directly
 * (same setRelay mutation Switches.tsx uses) rather than only linking
 * out, because a quick-glance power dashboard that makes you leave it
 * to flip a switch has missed the point of having one.
 */
export function CockpitDashboard() {
  const qc = useQueryClient();
  const { data: brief } = useQuery({ queryKey: ['mission-brief'], queryFn: api.missionBrief, refetchInterval: 30_000 });
  const battery = useBattery();
  const solar = useSolar();
  const energy = useEnergy();
  const env = useEnvironment();
  const connected = useConnected();
  const now = useClock();

  const loc = useQuery({ queryKey: ['location'], queryFn: api.location, retry: false });
  const heater = useQuery({ queryKey: ['heater'], queryFn: api.heater, refetchInterval: 2_000, retry: false });
  const roof = useQuery({ queryKey: ['roof'], queryFn: api.roofStatus, refetchInterval: 10_000, retry: false });
  const voice = useQuery({ queryKey: ['voice-control-status'], queryFn: api.voiceControlStatus, refetchInterval: 3_000, retry: false });
  const relays = useQuery({ queryKey: ['relays'], queryFn: api.relays, refetchInterval: 5_000, retry: false });

  const setRelayMut = useMutation({
    mutationFn: ({ id, on }: { id: number; on: boolean }) => api.setRelay(id, on),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['relays'] }),
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) toast.error('Locked — the unlock screen will reappear.');
      else toast.error('Relay update failed');
    },
  });

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

  // Same exclusion Switches.tsx applies - roof channels are driven
  // through the hold-to-run watchdog, never a plain on/off toggle, and
  // showing them here as an ordinary switch would offer exactly the
  // control path the roof safety guard exists to prevent.
  const roofChannelIds = new Set(
    [roof.data?.up_channel, roof.data?.down_channel, ...(roof.data?.isolate_channels ?? [])].filter(
      (id): id is number => id != null,
    ),
  );
  const quickRelays = (relays.data?.channels ?? []).filter((r) => r.in_use && !roofChannelIds.has(r.id));

  return (
    <div className="relative">
      <div className="grid grid-cols-12 gap-5">
        {/* Hero strip */}
        <Tile index={0} className="col-span-6 xl:col-span-3">
          <GlassCard level="hero" glow="teal" className="h-full">
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
        </Tile>

        <Tile index={1} className="col-span-6 xl:col-span-3">
          <GlassCard level="hero" className="h-full">
            <CardHeader label="Solar" right={<Sun size={16} className="text-brand-orange" />} />
            <div className="num text-4xl font-bold">{fmtWatt(solar.payload?.watts)}</div>
            <div className="text-[11px] text-ink-faint mt-1">
              Peak today {fmtWatt(solar.payload?.peak_today_watts)} · {(solar.payload?.charge_state || 'off').toUpperCase()}
            </div>
            <div className="mt-3"><Sparkline data={solarSeries} width={280} height={48} stroke="#FF8A00" fill="rgba(255,138,0,0.22)" minRange={25} /></div>
          </GlassCard>
        </Tile>

        <Tile index={2} className="col-span-6 xl:col-span-3">
          <GlassCard level="hero" className="h-full">
            <CardHeader label="Net energy" hint="solar − load" right={<Zap size={16} className="text-aurora-teal" />} />
            <div className="num text-4xl font-bold">{fmtWatt(energy.payload?.net_watts)}</div>
            <div className="text-[11px] text-ink-faint mt-2">in {fmtWatt(energy.payload?.solar_watts)} · out {fmtWatt(energy.payload?.load_watts)}</div>
          </GlassCard>
        </Tile>

        {/* Whole card is now the link (was just the footer text before -
            "status should be clickable and show you"). */}
        <Tile index={3} className="col-span-6 xl:col-span-3">
          <Link to="/overview" className="block h-full">
            <GlassCard level="hero" glow="purple" className="h-full relative overflow-hidden hover:ring-aurora-purple/40 transition-colors">
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
              <div className="text-xs text-ink-soft mt-3 line-clamp-2">{brief?.summary || 'Assembling mission brief…'}</div>
            </GlassCard>
          </Link>
        </Tile>

        {/* Camera + GPS row */}
        <Tile index={4} className="col-span-12 lg:col-span-7">
          <Link to="/camera" className="block h-full">
            {/* aspect-[16/10], not an arbitrary minHeight - matches
                Home.tsx's own camera tile exactly. Without a locked
                aspect ratio, a wide grid column with a short fixed
                height crops the feed down to a thin sliver of the real
                frame ("stretched", reported 14 Sep) - object-cover
                doesn't actually stretch, but a badly-shaped box makes
                it look like it does. */}
            <GlassCard className="h-full p-0 overflow-hidden relative aspect-[16/10] hover:ring-white/20 transition-all">
              <img
                src={api.cameraSnapshotUrl(Math.floor(now.getTime() / 5000) * 5000)}
                alt="Van camera"
                className="absolute inset-0 w-full h-full object-cover"
                // display:none, not opacity:0 - matches Home.tsx's own
                // onError handling exactly, so a failed frame collapses
                // the same way in both places rather than leaving an
                // invisible-but-still-laid-out element behind.
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

        <Tile index={5} className="col-span-12 lg:col-span-5">
          <Link to="/nearby" className="block h-full">
            <GlassCard className="h-full p-0 overflow-hidden relative aspect-[16/10] hover:ring-white/20 transition-all">
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
              </div>
            </GlassCard>
          </Link>
        </Tile>

        {/* Heater / Ron / Power - the domains Home.tsx never showed.
            Roof dropped entirely per feedback - it didn't earn its
            place on a glance-dashboard the way the other three do. */}
        <Tile index={6} className="col-span-12 lg:col-span-4">
          <Link to="/heater" className="block h-full">
            <GlassCard className="h-full hover:ring-white/20 transition-all">
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
          </Link>
        </Tile>

        <Tile index={7} className="col-span-12 lg:col-span-4">
          <Link to="/chat" className="block h-full">
            <GlassCard className="h-full hover:ring-white/20 transition-all">
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
          </Link>
        </Tile>

        {/* Real quick-toggles, not a link out - "having power on the
            main dash, even stripped down, may be good" (Andrew, 14
            Sep). Agreed: a glance dashboard that makes you leave it to
            flip a switch hasn't earned the word "dashboard". Same
            setRelay mutation and roof-channel exclusion Switches.tsx
            itself uses - spares (in_use: false) never show here
            either, same reasoning as Switches.tsx: offering a toggle
            with no real load behind it is the same false confidence
            this app avoids everywhere else. */}
        <Tile index={8} className="col-span-12 lg:col-span-4">
          <GlassCard className="h-full flex flex-col">
            <CardHeader label="Power" right={<PowerIcon size={16} className="text-aurora-teal" />} />
            {quickRelays.length === 0 ? (
              <div className="text-sm text-ink-faint mt-2">No relays wired yet.</div>
            ) : (
              <div className="flex flex-col gap-2 mt-1">
                {quickRelays.map((r) => (
                  <div
                    key={r.id}
                    className={`flex items-center justify-between rounded-xl px-3 py-2.5 transition-colors ${
                      r.commanded_on ? 'bg-aurora-teal/10 ring-1 ring-inset ring-aurora-teal/30' : 'bg-ink/[0.04] ring-1 ring-inset ring-ink/10'
                    }`}
                  >
                    <span className={`text-sm truncate ${r.commanded_on ? 'text-ink font-medium' : 'text-ink-soft'}`}>{r.name}</span>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className={`text-[11px] font-semibold uppercase tracking-wide ${r.commanded_on ? 'text-aurora-teal' : 'text-ink-faint'}`}>
                        {r.commanded_on ? 'On' : 'Off'}
                      </span>
                      {/* A real switch, not just a colour tint on the row -
                          "we can't tell what's turned on or not" (14 Sep).
                          Position + colour + label together, so it reads
                          at a glance even on a screen across the room. */}
                      <Switch
                        checked={r.commanded_on}
                        disabled={setRelayMut.isPending}
                        onCheckedChange={(on: boolean) => setRelayMut.mutate({ id: r.id, on })}
                        className="data-[state=checked]:bg-aurora-teal data-[state=unchecked]:bg-white/15"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <Link to="/switches" className="mt-auto pt-3 inline-flex items-center gap-1 text-[11px] text-ink-faint hover:text-aurora-teal transition-colors self-start">
              Manage all <ArrowRight size={11} />
            </Link>
          </GlassCard>
        </Tile>

        {/* Temperatures - one combined card, not two separate ones
            (feedback: "temps should be in their own card together").
            Dropped from the Net Energy hero card above too, so this is
            now the ONE place these two readings live rather than
            appearing twice on the same screen. */}
        <Tile index={9} className="col-span-12">
          <Link to="/weather" className="block">
            <GlassCard level="quiet" className="hover:ring-white/15 transition-colors">
              <CardHeader label="Temperatures" hint="1-Wire probes" right={<Thermometer size={16} className="text-aurora-teal" />} />
              <div className="flex gap-10">
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
    </div>
  );
}
