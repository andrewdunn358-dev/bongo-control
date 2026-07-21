import { GlassCard, CardHeader } from '@/components/primitives/GlassCard';
import { StatusPill } from '@/components/primitives/StatusPill';
import { Sparkline } from '@/components/primitives/Sparkline';
import { useBattery, useSparkBuffer } from '@/lib/telemetry';
import type { BatteryPayload } from '@/lib/types';
import { fmtVolt, fmtWatt, DASH } from '@/lib/format';
import { BATTERY } from '@/constants/testIds';

export function Battery() {
  const b = useBattery();
  const p = b.payload;
  const voltSeries = useSparkBuffer<BatteryPayload>('battery', (x) => x.voltage);

  return (
    <div data-testid={BATTERY.root} className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10 py-6 lg:py-10">
      <div className="mb-6">
        <div className="text-[11px] uppercase tracking-[0.24em] text-ink-muted">Battery</div>
        <h1 className="text-3xl md:text-5xl font-semibold tracking-tight mt-1">Voltage-first battery view</h1>
        <div className="text-sm text-ink-muted mt-2">
          No SoC percentage is shown. There is no shunt fitted, and reading
          a percentage off voltage alone would be a guess — often a wrong one.
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4 lg:gap-6">
        <GlassCard glow="teal" className="col-span-12 md:col-span-7 p-6 lg:p-8" data-testid={BATTERY.voltage}>
          <CardHeader label="Voltage" hint="MPPT / BMS" right={<StatusPill tone={p?.charging ? 'green' : 'slate'} data-testid={BATTERY.charging}>{p?.charging ? 'CHARGING' : 'IDLE'}</StatusPill>} />
          <div className="num text-6xl font-semibold">{fmtVolt(p?.voltage)}</div>
          <div className="mt-6"><Sparkline data={voltSeries} width={520} height={80} stroke="#22d3ee" fill="rgba(34,211,238,0.25)" /></div>
        </GlassCard>

        <GlassCard className="col-span-12 md:col-span-5 p-6">
          <CardHeader label="What we know" hint="honest inventory" />
          <ul className="space-y-3 text-sm">
            <li className="flex justify-between border-b border-ink/5 pb-2">
              <span className="text-ink-muted">Bank voltage</span><span className="num">{fmtVolt(p?.voltage)}</span>
            </li>
            <li className="flex justify-between border-b border-ink/5 pb-2">
              <span className="text-ink-muted">Charging</span><span>{p?.charging === undefined ? DASH : p.charging ? 'yes' : 'no'}</span>
            </li>
            <li className="flex justify-between border-b border-ink/5 pb-2">
              <span className="text-ink-muted">Charge power (MPPT → bank)</span><span className="num">{fmtWatt(p?.charging_power_w ?? null)}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-ink-muted">State of charge</span><span className="num text-ink-faint">{DASH}%</span>
            </li>
          </ul>
          <div className="mt-4 text-xs text-ink-faint leading-relaxed">
            A SmartShunt is planned. When it lands, this screen will pick up an
            SoC automatically — no rebuild required.
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
