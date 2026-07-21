import { GlassCard, CardHeader } from '@/components/primitives/GlassCard';
import { StatusPill } from '@/components/primitives/StatusPill';
import { Sparkline } from '@/components/primitives/Sparkline';
import { useSolar, useSparkBuffer } from '@/lib/telemetry';
import type { SolarPayload } from '@/lib/types';
import { fmtWatt, fmtAmp, fmtWh, DASH } from '@/lib/format';
import { SOLAR } from '@/constants/testIds';

export function Solar() {
  const s = useSolar();
  const p = s.payload;
  const series = useSparkBuffer<SolarPayload>('solar', (x) => x.watts);

  return (
    <div data-testid={SOLAR.root} className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10 py-6 lg:py-10">
      <div className="mb-6">
        <div className="text-[11px] uppercase tracking-[0.24em] text-ink-muted">Solar / MPPT</div>
        <h1 className="text-3xl md:text-5xl font-semibold tracking-tight mt-1">Sun into the bank</h1>
        <div className="text-sm text-ink-muted mt-2">
          Live reading from the Victron MPPT over Bluetooth. Load figures on
          this screen are the MPPT&apos;s LOAD terminal — not the total draw of the van.
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4 lg:gap-6">
        <GlassCard glow="purple" className="col-span-12 md:col-span-7 p-6 lg:p-8" data-testid={SOLAR.watts}>
          <CardHeader label="Incoming" hint={`peak today ${fmtWatt(p?.peak_today_watts)}`} right={<StatusPill tone="purple" data-testid={SOLAR.chargeState}>{(p?.charge_state || 'off').toUpperCase()}</StatusPill>} />
          <div className="num text-6xl font-semibold">{fmtWatt(p?.watts)}</div>
          <div className="mt-6"><Sparkline data={series} width={520} height={80} stroke="#a855f7" fill="rgba(168,85,247,0.3)" minRange={25} /></div>
        </GlassCard>

        <GlassCard className="col-span-12 md:col-span-5 p-6">
          <CardHeader label="Details" hint="MPPT fields" />
          <ul className="space-y-3 text-sm">
            <li className="flex justify-between border-b border-ink/5 pb-2"><span className="text-ink-muted">Yield today</span><span className="num">{fmtWh(p?.yield_today_wh ?? null)}</span></li>
            <li className="flex justify-between border-b border-ink/5 pb-2"><span className="text-ink-muted">Charger state</span><span>{p?.charge_state || DASH}</span></li>
            <li className="flex justify-between border-b border-ink/5 pb-2"><span className="text-ink-muted">Charger error</span><span>{p?.charger_error || 'none'}</span></li>
            <li className="flex justify-between border-b border-ink/5 pb-2"><span className="text-ink-muted">LOAD current</span><span className="num">{fmtAmp(p?.load_current_a ?? null)}</span></li>
            <li className="flex justify-between"><span className="text-ink-muted">LOAD power</span><span className="num">{fmtWatt(p?.load_power_w ?? null)}</span></li>
          </ul>
          <div className="mt-4 text-xs text-ink-faint leading-relaxed">
            LOAD is only the current drawn through the MPPT&apos;s dedicated LOAD terminal.
            Van-wide load isn&apos;t measurable without a shunt.
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
