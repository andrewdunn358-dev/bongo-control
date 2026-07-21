import { AlertTriangle } from 'lucide-react';
import { useTelemetry } from '@/lib/telemetry';
import { APP } from '@/constants/testIds';

/**
 * Simulated-data banner — appears whenever ANY telemetry domain arrives
 * with `source === "simulation"`. Names the affected domains explicitly so
 * the user is never in doubt about what they're looking at.
 *
 * This is a load-bearing safety feature. During development the simulation
 * plugin was accidentally re-enabled and displayed a confident but entirely
 * fabricated 78% SoC. This banner is how we stop that ever landing silently.
 */
export function SimBanner() {
  const { simulatedDomains } = useTelemetry();
  if (simulatedDomains.length === 0) return null;
  const names = simulatedDomains.slice().sort().join(', ');
  return (
    <div
      data-testid={APP.simBanner}
      className="sticky top-0 z-30 mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-10 pt-3"
      role="status"
    >
      <div className="flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm bg-amber-500/10 ring-1 ring-inset ring-amber-400/40 text-status-amber animate-fade-in">
        <AlertTriangle size={16} className="shrink-0" />
        <span className="font-medium">Simulated data</span>
        <span className="text-ink-soft">— the following domain{simulatedDomains.length === 1 ? ' is' : 's are'} not from real hardware: <span className="num">{names}</span>.</span>
      </div>
    </div>
  );
}
