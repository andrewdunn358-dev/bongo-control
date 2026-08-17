import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, AlertTriangle, XCircle, Battery as BatteryIcon, Sun, Thermometer, Zap, SunMedium, CloudSun, CloudOff, Navigation, Camera as CameraIcon } from 'lucide-react';
import { GlassCard, CardHeader } from '@/components/primitives/GlassCard';
import { SatelliteSky } from '@/components/SatelliteSky';
import { StatusPill } from '@/components/primitives/StatusPill';
import { GaugeRing } from '@/components/primitives/GaugeRing';
import { Sparkline } from '@/components/primitives/Sparkline';
import { api } from '@/lib/api';
import { useBattery, useSolar, useEnergy, useEnvironment, useSparkBuffer, useConnected } from '@/lib/telemetry';
import { fmtVolt, fmtWatt, fmtTemp, DASH } from '@/lib/format';
import type { BatteryPayload, SolarPayload } from '@/lib/types';
import { HOME } from '@/constants/testIds';

const STATUS_META = {
  green: { tone: 'green' as const, label: 'GREEN', icon: ShieldCheck },
  amber: { tone: 'amber' as const, label: 'AMBER', icon: AlertTriangle },
  red: { tone: 'red' as const, label: 'RED', icon: XCircle },
};

const VERDICT_META = {
  good: { tone: 'green' as const, label: 'GOOD', Icon: SunMedium },
  normal: { tone: 'teal' as const, label: 'NORMAL', Icon: CloudSun },
  low: { tone: 'amber' as const, label: 'LOW', Icon: CloudOff },
};

function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useState(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  });
  return now;
}

export function Home() {
  const { data: brief } = useQuery({
    queryKey: ['mission-brief'],
    queryFn: api.missionBrief,
    refetchInterval: 30_000,
  });
  const battery = useBattery();
  const solar = useSolar();
  const energy = useEnergy();
  const env = useEnvironment();
  const connected = useConnected();
  const now = useClock();

  const loc = useQuery({ queryKey: ['location'], queryFn: api.location, retry: false });
  const sats = useQuery({ queryKey: ['gps-satellites'], queryFn: api.gpsSatellites, retry: false });

  const solarSeries = useSparkBuffer<SolarPayload>('solar', (p) => p.watts);
  const voltSeries = useSparkBuffer<BatteryPayload>('battery', (p) => p.voltage);

  const meta = STATUS_META[brief?.status ?? 'green'];
  const Icon = meta.icon;

  const solarSig = brief?.signals?.find((s) => s.source === 'solar_verdict');
  const vMeta = solarSig?.detail?.verdict ? VERDICT_META[solarSig.detail.verdict] : null;
  const VIcon = vMeta?.Icon ?? Sun;

  const solarHist = brief?.signals?.find((s) => s.source === 'solar_history')?.detail as
    | { today_wh?: number; avg_wh?: number; best_wh?: number; days?: number }
    | undefined;
  const kwh = (wh?: number) => (wh == null ? null : (wh / 1000).toFixed(wh >= 1000 ? 1 : 2));

  const satCount = loc.data?.satellites ?? (sats.data?.satellites?.filter((s) => s.snr != null).length ?? null);

  return (
    <div data-testid={HOME.root} className="mx-auto max-w-[1600px]">
      <div className="grid grid-cols-12 gap-4 lg:gap-5">
        {/* Left column - battery/solar, each with real sparkline history */}
        <div className="col-span-12 lg:col-span-3 flex flex-col gap-4">
          <GlassCard glow="teal" className="p-5" data-testid={HOME.batteryVoltage}>
            <CardHeader label="Battery voltage" right={<BatteryIcon size={15} className="text-aurora-teal" />} />
            <div className="num text-3xl font-bold">{fmtVolt(battery.payload?.voltage)}</div>
            <div className="text-[11px] text-ink-faint mt-1">{battery.payload?.charging ? 'Charging' : 'Resting reading'}</div>
            <div className="mt-3"><Sparkline data={voltSeries} width={260} height={44} stroke="#22d3ee" fill="rgba(34,211,238,0.25)" minRange={0.4} /></div>
            <div className="text-[10px] text-ink-faint mt-2">Last hour · no shunt · voltage only</div>
          </GlassCard>

          <GlassCard glow="orange" className="p-5" data-testid={HOME.solarWatts}>
            <CardHeader label="Solar" right={<Sun size={15} className="text-brand-orange" />} />
            <div className="num text-3xl font-bold">{fmtWatt(solar.payload?.watts)}</div>
            <div className="text-[11px] text-ink-faint mt-1">
              Peak today {fmtWatt(solar.payload?.peak_today_watts)} · {(solar.payload?.charge_state || 'off').toUpperCase()}
            </div>
            <div className="mt-3"><Sparkline data={solarSeries} width={260} height={44} stroke="#FF8A00" fill="rgba(255,138,0,0.22)" minRange={25} /></div>
          </GlassCard>

          <GlassCard className="p-5">
            <CardHeader label="Net energy" hint="solar − load" right={<Zap size={15} className="text-aurora-teal" />} />
            <div className="num text-2xl font-semibold">{fmtWatt(energy.payload?.net_watts)}</div>
            <div className="text-[11px] text-ink-faint mt-1">in {fmtWatt(energy.payload?.solar_watts)} · out {fmtWatt(energy.payload?.load_watts)}</div>
          </GlassCard>
        </div>

        {/* Centre column - the hero + insight card.
            The camera is the hero here and GPS is the small card on the
            right; they were the other way round until Frankie swapped
            them. The camera earns the space: it is the one panel whose
            value scales with size (a thumbnail of the van's interior is
            hard to read), whereas GPS is a satellite count and a
            coordinate pair, which are just as legible small. */}
        <div className="col-span-12 lg:col-span-6 flex flex-col gap-4">
          <div className="relative rounded-2xl overflow-hidden aspect-[16/10] ring-1 ring-white/10 shadow-2xl bg-black/50">
            <img
              src={api.cameraSnapshotUrl(Math.floor(Date.now() / 15000))}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            {/* Gradient scrims: the snapshot is arbitrary brightness, so
                the overlaid labels need their own contrast rather than
                relying on the image being dark. */}
            <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/65 to-transparent z-10" />
            <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/65 to-transparent z-10" />
            <div className="absolute top-4 left-4 z-20 flex items-center gap-2">
              <CameraIcon size={15} className="text-ink-soft" />
              <span className="text-[10px] tracking-[0.25em] uppercase font-semibold text-ink-soft">Camera</span>
            </div>
            <StatusPill tone={connected ? 'teal' : 'red'} className="absolute top-4 right-4 z-20">{connected ? 'LIVE' : 'OFFLINE'}</StatusPill>
            <div className="absolute inset-x-0 bottom-4 text-center z-20">
              <div className="num text-4xl font-bold text-white" style={{ textShadow: '0 2px 20px rgba(0,0,0,.6)' }}>
                {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>

          <Link to="/overview" className="block">
            <GlassCard
              glow={meta.tone === 'red' ? undefined : 'teal'}
              className="p-5 hover:ring-aurora-teal/40 transition-colors"
              data-testid={HOME.sitrepBadge}
            >
              <div className="flex items-start gap-3">
                <GaugeRing tone={meta.tone} size={44} progress={meta.tone === 'green' ? 1 : meta.tone === 'amber' ? 0.6 : 0.3}>
                  <Icon size={16} className={meta.tone === 'green' ? 'text-status-green' : meta.tone === 'amber' ? 'text-status-amber' : 'text-status-red'} />
                </GaugeRing>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-ink-muted">Mission brief · tap for the full picture</div>
                  <div className="text-sm md:text-base font-medium mt-0.5">{brief?.summary || 'Assembling mission brief…'}</div>
                </div>
              </div>
            </GlassCard>
          </Link>
        </div>

        {/* Right column - weather/internet/camera, all real */}
        <div className="col-span-12 lg:col-span-3 flex flex-col gap-4">
          <GlassCard className="p-5">
            <CardHeader label="Weather" />
            <div className="num text-3xl font-bold">{fmtTemp(env.payload?.external_temp_c)}</div>
            <div className="text-xs text-ink-soft mt-1">{DASH}</div>
          </GlassCard>

          {/* GPS, moved here from the centre hero. The SatelliteSky
              animation is kept as the card's backdrop rather than
              dropped - it is what makes this read as the sky view at a
              glance - but the coordinates now sit inline instead of
              floating over the middle of a large panel. */}
          <GlassCard className="p-0 overflow-hidden relative min-h-[190px]">
            <SatelliteSky className="absolute inset-0 z-0 opacity-70" />
            <div className="relative z-10 p-5">
              <div className="text-[10px] tracking-[0.25em] text-status-green uppercase font-semibold">GPS Locked</div>
              <div className="text-2xl font-bold mt-0.5">{satCount ?? DASH} Satellites</div>
              {loc.data?.hdop != null && <div className="text-xs text-ink-soft mt-0.5">HDOP {loc.data.hdop.toFixed(1)}</div>}
              {loc.data?.latitude != null && loc.data?.longitude != null && (
                <div className="text-xs text-ink-soft mt-3 num" style={{ textShadow: '0 2px 12px rgba(0,0,0,.6)' }}>
                  {loc.data.latitude.toFixed(4)}°, {loc.data.longitude.toFixed(4)}°
                </div>
              )}
              <Link
                to="/nearby"
                className="mt-3 inline-flex items-center gap-1.5 rounded-full pl-3.5 pr-2.5 py-1.5 text-xs font-medium bg-black/50 backdrop-blur-md ring-1 ring-white/15 hover:bg-black/65"
              >
                Navigate <Navigation size={12} />
              </Link>
            </div>
          </GlassCard>
        </div>
      </div>

      {/* Secondary detail - solar verdict, temps, charging power */}
      <div className="grid grid-cols-12 gap-4 lg:gap-5 mt-4 lg:mt-5">
        {solarSig && (
          <GlassCard className="col-span-12 p-6" data-testid={HOME.solarVerdict}>
            <div className="flex items-start gap-4">
              <div
                className={`h-12 w-12 rounded-2xl grid place-items-center ring-1 ring-inset shrink-0 ${
                  vMeta?.tone === 'green'
                    ? 'bg-emerald-500/15 ring-emerald-400/30 text-status-green'
                    : vMeta?.tone === 'amber'
                    ? 'bg-amber-500/15 ring-amber-400/30 text-status-amber'
                    : 'bg-aurora-teal/15 ring-aurora-teal/30 text-aurora-teal'
                }`}
              >
                <VIcon size={22} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-ink-muted">Solar today</div>
                  {vMeta && <StatusPill tone={vMeta.tone}>{vMeta.label}</StatusPill>}
                </div>
                <div className="text-base md:text-lg text-ink-soft mt-1.5">{solarSig.message}</div>
                {solarSig.detail?.today_mj != null && (
                  <div className="text-xs text-ink-faint mt-2 num">
                    {solarSig.detail.today_mj} MJ/m² forecast
                    {solarSig.detail.clearsky_mj != null ? ` · clear-sky ceiling ${solarSig.detail.clearsky_mj} MJ/m²` : ''}
                    {solarSig.detail.yield_today_wh != null ? ` · ${solarSig.detail.yield_today_wh} Wh harvested` : ''}
                  </div>
                )}
                {solarHist?.avg_wh != null && (
                  <div className="text-xs text-ink-faint mt-1 num">
                    Recent harvest: {kwh(solarHist.avg_wh)} kWh/day avg
                    {solarHist.best_wh != null ? ` · best ${kwh(solarHist.best_wh)} kWh` : ''}
                    {solarHist.today_wh ? ` · today ${kwh(solarHist.today_wh)} kWh` : ''}
                    <span className="text-ink-faint/70"> (last {solarHist.days ?? 0} days)</span>
                  </div>
                )}
              </div>
            </div>
          </GlassCard>
        )}

        <GlassCard className="col-span-6 md:col-span-3 p-6" data-testid={HOME.interiorTemp}>
          <CardHeader label="Interior" hint="1-Wire probe" right={<Thermometer size={16} className="text-aurora-teal" />} />
          <div className="num text-3xl font-semibold">{fmtTemp(env.payload?.internal_temp_c)}</div>
        </GlassCard>

        <GlassCard className="col-span-6 md:col-span-3 p-6" data-testid={HOME.externalTemp}>
          <CardHeader label="Outside" hint="1-Wire probe" right={<Sun size={16} className="text-brand-orange" />} />
          <div className="num text-3xl font-semibold">{fmtTemp(env.payload?.external_temp_c)}</div>
        </GlassCard>

        <GlassCard className="col-span-12 md:col-span-6 p-6">
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              <BatteryIcon size={14} className="text-ink-muted" />
              <span className="text-xs text-ink-muted uppercase tracking-widest">charging power</span>
              <span className="num text-lg ml-1">{fmtWatt(battery.payload?.charging_power_w ?? null)}</span>
            </div>
            <div className="text-ink-faint text-xs">From the MPPT — total van draw isn't measurable without a shunt.</div>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
