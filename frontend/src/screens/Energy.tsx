import { GlassCard, CardHeader } from '@/components/primitives/GlassCard';
import { useEnergy } from '@/lib/telemetry';
import { fmtWatt, DASH } from '@/lib/format';
import { ENERGY } from '@/constants/testIds';

export function Energy() {
  const e = useEnergy();
  const p = e.payload;
  const loads = p?.loads ?? {};
  const loadEntries = Object.entries(loads);

  return (
    <div data-testid={ENERGY.root} className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10 py-6 lg:py-10">
      <div className="mb-6">
        <div className="text-[11px] uppercase tracking-[0.24em] text-ink-muted">Energy flow</div>
        <h1 className="text-3xl md:text-5xl font-semibold tracking-tight mt-1">Solar in <span className="text-aurora-teal">→</span> bank <span className="text-aurora-purple">→</span> load</h1>
        <div className="text-sm text-ink-muted mt-2">Aggregated view of what the MPPT and the loads dictionary report.</div>
      </div>

      <div className="grid grid-cols-12 gap-4 lg:gap-6">
        <GlassCard className="col-span-12 lg:col-span-4 p-6">
          <CardHeader label="Solar in" />
          <div className="num text-5xl font-semibold">{fmtWatt(p?.solar_watts)}</div>
        </GlassCard>
        <GlassCard glow="teal" className="col-span-12 lg:col-span-4 p-6" data-testid={ENERGY.net}>
          <CardHeader label="Net" hint="in minus out" />
          <div className="num text-5xl font-semibold">{fmtWatt(p?.net_watts)}</div>
        </GlassCard>
        <GlassCard className="col-span-12 lg:col-span-4 p-6">
          <CardHeader label="Load out" />
          <div className="num text-5xl font-semibold">{fmtWatt(p?.load_watts)}</div>
        </GlassCard>

        <GlassCard className="col-span-12 p-6" data-testid={ENERGY.loads}>
          <CardHeader label="Circuits reported by backend" hint={`${loadEntries.length} entr${loadEntries.length === 1 ? 'y' : 'ies'}`} />
          {loadEntries.length === 0 ? (
            <div className="rounded-2xl p-6 bg-ink/[0.03] ring-1 ring-inset ring-ink/10 text-sm text-ink-soft">
              No circuit sensing is fitted on this van, so <span className="num">loads</span> is empty.
              Individual switch state is available on the <a href="/switches" className="text-aurora-teal underline">Switches</a> page — those figures reflect what the app <em>commanded</em>, not measured circuit current.
            </div>
          ) : (
            <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {loadEntries.map(([name, on]) => (
                <li key={name} className="rounded-xl px-4 py-3 bg-ink/[0.03] ring-1 ring-inset ring-ink/10 flex items-center justify-between">
                  <span className="text-sm">{name}</span>
                  <span className={`num text-xs px-2 py-0.5 rounded-full ${on ? 'bg-emerald-500/15 text-status-green' : 'bg-ink/5 text-ink-muted'}`}>{on ? 'ON' : 'OFF'}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="text-xs text-ink-faint mt-3">Values shown come from the backend&apos;s <span className="num">EnergyPayload.loads</span>. If real circuit sensing is added later, it appears here automatically — no UI change needed.</div>
        </GlassCard>

        {loads && Object.keys(loads).length === 0 && (
          <div className="col-span-12 text-xs text-ink-faint">
            <span className="text-ink-muted">Note:</span> if you see anything other than {DASH} in these totals, it&apos;s live data from the MPPT / backend — no fabricated fill values are ever displayed here.
          </div>
        )}
      </div>
    </div>
  );
}
