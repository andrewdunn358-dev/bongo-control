import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, AlertTriangle, XCircle, Battery as BatteryIcon, Sun, Thermometer, Zap } from 'lucide-react';
import { GlassCard, CardHeader } from '@/components/primitives/GlassCard';
import { StatusPill } from '@/components/primitives/StatusPill';
import { Sparkline } from '@/components/primitives/Sparkline';
import { api } from '@/lib/api';
import { useBattery, useSolar, useEnergy, useEnvironment, useSparkBuffer } from '@/lib/telemetry';
import { fmtVolt, fmtWatt, fmtTemp, DASH } from '@/lib/format';
import type { BatteryPayload, SolarPayload } from '@/lib/types';
import { HOME } from '@/constants/testIds';

const STATUS_META = {
  green: { tone: 'green' as const, label: 'GREEN', icon: ShieldCheck },
  amber: { tone: 'amber' as const, label: 'AMBER', icon: AlertTriangle },
  red: { tone: 'red' as const, label: 'RED', icon: XCircle },
};

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

  const solarSeries = useSparkBuffer<SolarPayload>('solar', (p) => p.watts);
  const voltSeries = useSparkBuffer<BatteryPayload>('battery', (p) => p.voltage);

  const meta = STATUS_META[brief?.status ?? 'green'];
  const Icon = meta.icon;

  return (
    <div data-testid={HOME.root} className="mx-auto max-w-[1500px] px-4 sm:px-6 lg:px-10 py-6 lg:py-10">
      <div className="mb-6">
        <div className="text-[11px] uppercase tracking-[0.24em] text-ink-muted">Cockpit</div>
        <h1 className="text-3xl md:text-5xl font-semibold tracking-tight mt-1">
          Van at a <span className="text-aurora-teal">glance</span>
        </h1>
        <div className="text-sm text-ink-muted mt-2">
          Live voltage, solar, temperature and mission verdict — nothing fabricated.
        </div>
      </div>

      {/* SITREP verdict — the primary information on this screen */}
      <GlassCard glow={meta.tone === 'red' ? undefined : 'teal'} className="p-6 lg:p-8 mb-6" data-testid={HOME.sitrepBadge}>
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div
            className={`h-14 w-14 rounded-2xl grid place-items-center ring-1 ring-inset ${
              meta.tone === 'green'
                ? 'bg-emerald-500/15 ring-emerald-400/30 text-status-green'
                : meta.tone === 'amber'
                ? 'bg-amber-500/15 ring-amber-400/30 text-status-amber'
                : 'bg-red-500/15 ring-red-400/40 text-status-red'
            }`}
          >
            <Icon size={26} />
          </div>
          <div className="min-w-0 flex-1">
            <StatusPill tone={meta.tone}>{meta.label} · MISSION</StatusPill>
            <div className="text-xl md:text-2xl font-semibold tracking-tight mt-2">
              {brief?.summary || 'Assembling mission brief…'}
            </div>
            {!!brief?.recommendations?.length && (
              <ul className="mt-2 text-sm text-ink-soft space-y-1">
                {brief!.recommendations.slice(0, 2).map((r, i) => (
                  <li key={i} className="flex gap-2"><span className="text-ink-muted">·</span>{r}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </GlassCard>

      <div className="grid grid-cols-12 gap-4 lg:gap-6">
        {/* Battery voltage — no SoC gauge on purpose */}
        <GlassCard glow="teal" className="col-span-12 md:col-span-6 p-6" data-testid={HOME.batteryVoltage}>
          <CardHeader
            label="Battery"
            hint="voltage-only — no shunt fitted"
            right={<StatusPill tone={battery.payload?.charging ? 'green' : 'slate'}>{battery.payload?.charging ? 'CHARGING' : 'IDLE'}</StatusPill>}
          />
          <div className="flex items-baseline gap-2">
            <span className="num text-5xl font-semibold">{fmtVolt(battery.payload?.voltage)}</span>
          </div>
          <div className="text-xs text-ink-faint mt-1">State-of-charge {DASH}% · a percentage would be a guess without a shunt.</div>
          <div className="mt-4"><Sparkline data={voltSeries} width={340} height={54} stroke="#22d3ee" fill="rgba(34,211,238,0.25)" /></div>
        </GlassCard>

        {/* Solar */}
        <GlassCard glow="purple" className="col-span-12 md:col-span-6 p-6" data-testid={HOME.solarWatts}>
          <CardHeader
            label="Solar in"
            hint={`peak today ${fmtWatt(solar.payload?.peak_today_watts)}`}
            right={<StatusPill tone="purple">{(solar.payload?.charge_state || 'off').toUpperCase()}</StatusPill>}
          />
          <div className="flex items-baseline gap-2">
            <span className="num text-5xl font-semibold">{fmtWatt(solar.payload?.watts)}</span>
          </div>
          <div className="text-xs text-ink-faint mt-1">MPPT reading · today {solar.payload?.yield_today_wh ? `${(solar.payload.yield_today_wh / 1000).toFixed(2)} kWh` : DASH}</div>
          <div className="mt-4"><Sparkline data={solarSeries} width={340} height={54} stroke="#a855f7" fill="rgba(168,85,247,0.28)" /></div>
        </GlassCard>

        {/* Net energy */}
        <GlassCard className="col-span-12 md:col-span-4 p-6" data-testid={HOME.netEnergy}>
          <CardHeader label="Net energy" hint="solar − load" right={<Zap size={16} className="text-aurora-teal" />} />
          <div className="num text-4xl font-semibold">{fmtWatt(energy.payload?.net_watts)}</div>
          <div className="text-xs text-ink-faint mt-1">
            in {fmtWatt(energy.payload?.solar_watts)} · out {fmtWatt(energy.payload?.load_watts)}
          </div>
        </GlassCard>

        {/* Interior temperature */}
        <GlassCard className="col-span-6 md:col-span-4 p-6" data-testid={HOME.interiorTemp}>
          <CardHeader label="Interior" hint="1-Wire probe" right={<Thermometer size={16} className="text-aurora-teal" />} />
          <div className="num text-4xl font-semibold">{fmtTemp(env.payload?.internal_temp_c)}</div>
          <div className="text-xs text-ink-faint mt-1">DS18B20 — humidity unavailable ({DASH})</div>
        </GlassCard>

        {/* External temperature */}
        <GlassCard className="col-span-6 md:col-span-4 p-6" data-testid={HOME.externalTemp}>
          <CardHeader label="Outside" hint="1-Wire probe" right={<Sun size={16} className="text-aurora-purple" />} />
          <div className="num text-4xl font-semibold">{fmtTemp(env.payload?.external_temp_c)}</div>
          <div className="text-xs text-ink-faint mt-1">Measured, not forecast.</div>
        </GlassCard>

        {/* Quick-glance battery current + charging power */}
        <GlassCard className="col-span-12 p-5">
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2"><BatteryIcon size={14} className="text-ink-muted" /> <span className="text-xs text-ink-muted uppercase tracking-widest">charging power</span> <span className="num text-lg ml-1">{fmtWatt(battery.payload?.charging_power_w ?? null)}</span></div>
            <div className="text-ink-faint text-xs">Charging power comes from the MPPT — total van draw is not measurable without a shunt.</div>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
