import { FlaskConical } from "lucide-react";
import { useTelemetry } from "../context/TelemetryContext";

/**
 * Warns when any displayed telemetry is coming from the simulation
 * plugin rather than real hardware.
 *
 * This exists because of a genuine incident: the simulation plugin got
 * re-enabled accidentally and its output raced the real hardware
 * plugins, so the dashboard confidently showed a 78% battery state of
 * charge - a figure that is physically unknowable on this van, which
 * has no battery shunt. It looked completely real. Everything else in
 * this app is careful not to present absent or estimated data as fact
 * (voltage-only battery caveats, "—" for missing readings, AI content
 * labelled as AI); simulated data silently masquerading as measured
 * data was the one remaining hole.
 */
export default function SimulatedDataBanner() {
  const { state } = useTelemetry();

  const simulatedDomains = Object.entries(state)
    .filter(([, message]) => message && typeof message === "object" && "source" in message && message.source === "simulation")
    .map(([domain]) => domain);

  if (simulatedDomains.length === 0) return null;

  return (
    <div className="mb-4 flex items-start gap-3 rounded-2xl border border-solar/30 bg-solar/10 p-3.5">
      <FlaskConical size={16} className="mt-0.5 shrink-0 text-solar" />
      <div className="min-w-0 text-sm">
        <div className="font-semibold text-text-primary">Showing simulated data</div>
        <div className="mt-0.5 text-text-secondary">
          {simulatedDomains.join(", ")} {simulatedDomains.length === 1 ? "is" : "are"} coming from the Simulation
          Engine, not real hardware. Disable it in Settings → Plugins to see only real readings.
        </div>
      </div>
    </div>
  );
}
