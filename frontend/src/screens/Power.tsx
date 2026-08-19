import { GlassCard, CardHeader } from '@/components/primitives/GlassCard';
import { StatusPill } from '@/components/primitives/StatusPill';
import { Sparkline } from '@/components/primitives/Sparkline';
import { useBattery, useSolar, useEnergy, useSparkBuffer } from '@/lib/telemetry';
import type { BatteryPayload, SolarPayload } from '@/lib/types';
import { fmtVolt, fmtWatt, fmtAmp, fmtWh, DASH } from '@/lib/format';
import { POWER } from '@/constants/testIds';

/**
 * Merged Battery + Solar + Energy into one page. Those three were each
 * genuinely thin (49-62 lines) and, worse, duplicating the same MPPT
 * readings under different names - Energy's "Solar in" and Solar's own
 * "Incoming" card were both just SolarPayload's watts figure relabelled
 * (confirmed by reading EnergyPayload/SolarPayload's actual field
 * definitions before merging, not assumed), and Energy's "Load out"
 * duplicated Solar's LOAD-terminal figure the same way. Net (solar
 * minus load) is the one number Energy actually added on top - kept,
 * the two redundant hero cards dropped. Same for the circuits/loads
 * list - genuinely unique content, kept as its own section.
 */
export function Power() {
  const b = useBattery();
  const s = useSolar();
  const e = useEnergy();
  const bp = b.payload;
  const sp = s.payload;
  const ep = e.payload;
  const voltSeries = useSparkBuffer<BatteryPayload>('battery', (x) => x.voltage);
  const solarSeries = useSparkBuffer<SolarPayload>('solar', (x) => x.watts);
  const loads = ep?.loads ?? {};
  const loadEntries = Object.entries(loads);

  return (
    <div data-testid={POWER.root} className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 py-6 lg:py-10">
      <div className="mb-6">
        <div className="text-[11px] uppercase tracking-[0.24em] text-ink-muted">Power</div>
        <h1 className="text-3xl md:text-5xl font-semibold tracking-tight mt-1">
          Sun in <span className="text-aurora-purple">→</span> bank <span className="text-aurora-teal">→</span> load
        </h1>
        <div className="text-sm text-ink-muted mt-2">
          Battery, solar, and the energy budget in one place — previously three separate pages showing some of the
          same MPPT readings twice.
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4 lg:gap-6">
        {/* Battery hero */}
        <GlassCard level="hero" glow="teal" className="col-span-12 lg:col-span-6" data-testid={POWER.batteryVoltage}>
          <CardHeader
            label="Battery"
            hint="MPPT / BMS"
            right={
              <StatusPill tone={bp?.charging ? 'green' : 'slate'} data-testid={POWER.batteryCharging}>
                {bp?.charging ? 'CHARGING' : 'IDLE'}
              </StatusPill>
            }
          />
          <div className="num text-4xl sm:text-5xl lg:text-6xl font-semibold">{fmtVolt(bp?.voltage)}</div>
          <div className="mt-6">
            <Sparkline data={voltSeries} width={520} height={80} stroke="#22d3ee" fill="rgba(34,211,238,0.25)" minRange={0.4} />
          </div>
        </GlassCard>

        {/* Solar hero */}
        <GlassCard className="col-span-12 lg:col-span-6" data-testid={POWER.solarWatts}>
          <CardHeader
            label="Solar"
            hint={`peak today ${fmtWatt(sp?.peak_today_watts)}`}
            right={
              <StatusPill tone="purple" data-testid={POWER.solarChargeState}>
                {(sp?.charge_state || 'off').toUpperCase()}
              </StatusPill>
            }
          />
          <div className="num text-4xl sm:text-5xl lg:text-6xl font-semibold">{fmtWatt(sp?.watts)}</div>
          <div className="mt-6">
            <Sparkline data={solarSeries} width={520} height={80} stroke="#a855f7" fill="rgba(168,85,247,0.3)" minRange={25} />
          </div>
        </GlassCard>

        {/* Battery details - honest inventory */}
        <GlassCard className="col-span-12 lg:col-span-6 p-6">
          <CardHeader label="Battery — what we know" hint="honest inventory" />
          <ul className="space-y-3 text-sm">
            <li className="flex justify-between border-b border-ink/5 pb-2">
              <span className="text-ink-muted">Bank voltage</span><span className="num">{fmtVolt(bp?.voltage)}</span>
            </li>
            <li className="flex justify-between border-b border-ink/5 pb-2">
              <span className="text-ink-muted">Charging</span><span>{bp?.charging === undefined ? DASH : bp.charging ? 'yes' : 'no'}</span>
            </li>
            <li className="flex justify-between border-b border-ink/5 pb-2">
              <span className="text-ink-muted">Charge power (MPPT → bank)</span><span className="num">{fmtWatt(bp?.charging_power_w ?? null)}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-ink-muted">State of charge</span><span className="num text-ink-faint">{DASH}%</span>
            </li>
          </ul>
          <div className="mt-4 text-xs text-ink-faint leading-relaxed">
            No SoC percentage is shown — there's no shunt fitted, and reading a percentage off voltage alone would be
            a guess, often a wrong one. A SmartShunt is planned; when it lands, this picks up an SoC automatically —
            no rebuild required.
          </div>
        </GlassCard>

        {/* Solar details - MPPT fields */}
        <GlassCard className="col-span-12 lg:col-span-6 p-6">
          <CardHeader label="Solar — MPPT fields" />
          <ul className="space-y-3 text-sm">
            <li className="flex justify-between border-b border-ink/5 pb-2"><span className="text-ink-muted">Yield today</span><span className="num">{fmtWh(sp?.yield_today_wh ?? null)}</span></li>
            <li className="flex justify-between border-b border-ink/5 pb-2"><span className="text-ink-muted">Charger state</span><span>{sp?.charge_state || DASH}</span></li>
            <li className="flex justify-between border-b border-ink/5 pb-2"><span className="text-ink-muted">Charger error</span><span>{sp?.charger_error || 'none'}</span></li>
            <li className="flex justify-between border-b border-ink/5 pb-2"><span className="text-ink-muted">LOAD current</span><span className="num">{fmtAmp(sp?.load_current_a ?? null)}</span></li>
            <li className="flex justify-between"><span className="text-ink-muted">LOAD power</span><span className="num">{fmtWatt(sp?.load_power_w ?? null)}</span></li>
          </ul>
          <div className="mt-4 text-xs text-ink-faint leading-relaxed">
            LOAD is only the current drawn through the MPPT&apos;s dedicated LOAD terminal — van-wide load isn&apos;t
            measurable without a shunt.
          </div>
        </GlassCard>

        {/* Net energy - the one genuinely unique figure Energy added */}
        <GlassCard className="col-span-12 lg:col-span-4 p-6" data-testid={POWER.net}>
          <CardHeader label="Net" hint="solar in minus load out" />
          <div className="num text-3xl sm:text-4xl lg:text-5xl font-semibold">{fmtWatt(ep?.net_watts)}</div>
        </GlassCard>

        {/* Circuits reported by backend */}
        <GlassCard className="col-span-12 lg:col-span-8 p-6" data-testid={POWER.loads}>
          <CardHeader label="Circuits reported by backend" hint={`${loadEntries.length} entr${loadEntries.length === 1 ? 'y' : 'ies'}`} />
          {loadEntries.length === 0 ? (
            <div className="rounded-2xl p-6 bg-ink/[0.03] ring-1 ring-inset ring-ink/10 text-sm text-ink-soft">
              No circuit sensing is fitted on this van, so <span className="num">loads</span> is empty. Individual
              switch state is available on the <a href="/switches" className="text-aurora-teal underline">Switches</a>{' '}
              page — those figures reflect what the app <em>commanded</em>, not measured circuit current.
            </div>
          ) : (
            <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {loadEntries.map(([name, on]) => (
                <li key={name} className="rounded-xl px-4 py-3 bg-ink/[0.03] ring-1 ring-inset ring-ink/10 flex items-center justify-between">
                  <span className="text-sm">{name}</span>
                  <span className={`num text-xs px-2 py-0.5 rounded-full ${on ? 'bg-emerald-500/15 text-status-green' : 'bg-ink/5 text-ink-muted'}`}>{on ? 'ON' : 'OFF'}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="text-xs text-ink-faint mt-3">
            Values shown come from the backend&apos;s <span className="num">EnergyPayload.loads</span>. If real
            circuit sensing is added later, it appears here automatically — no UI change needed.
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
