import { Sun, BatteryMedium, Home as HomeIcon, Cpu, BatteryWarning } from "lucide-react";
import { useTelemetry } from "../../context/TelemetryContext";

// Path geometry (viewBox 0 0 520 200): Solar -> Leisure Battery -> Van Loads
// -> External Battery (stub, not yet installed). Dots travel along these
// paths using CSS `offset-path`, which is the right tool for continuous
// looping motion — cheaper and smoother than driving it frame-by-frame
// from React/Framer Motion. "MPPT" is a label on the first path, not a
// separate telemetry-bearing node — there's no MPPT-specific data yet.
const SOLAR_TO_BATTERY_PATH = "M 65 58 C 130 58, 150 108, 208 108";
const BATTERY_TO_LOAD_PATH = "M 228 108 C 280 108, 300 150, 343 150";
// Dashed, no particles — External Battery isn't implemented yet
// (Milestone 6). Shown honestly as "not installed" rather than faked.
const LOAD_TO_EXTERNAL_PATH = "M 363 150 C 400 150, 420 108, 468 108";

function FlowDots({ path, color, speedSeconds, reverse, count }: { path: string; color: string; speedSeconds: number; reverse: boolean; count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flow-dot absolute h-2 w-2 rounded-full"
          style={{
            backgroundColor: color,
            offsetPath: `path("${path}")`,
            offsetRotate: "0deg",
            animation: `flow-travel ${speedSeconds}s linear infinite`,
            animationDelay: `${(i * speedSeconds) / count}s`,
            animationDirection: reverse ? "reverse" : "normal",
            boxShadow: `0 0 6px ${color}`,
          }}
        />
      ))}
    </>
  );
}

export default function PowerFlowDiagram() {
  const { state } = useTelemetry();
  const solarWatts = state.solar?.payload.watts ?? 0;
  const battery = state.battery?.payload;
  const loadWatts = state.energy?.payload.load_watts ?? 0;
  const charging = battery?.charging ?? false;

  // Dot count/speed communicates magnitude — more watts, more/faster dots.
  const solarCount = solarWatts > 5 ? Math.min(4, Math.max(1, Math.round(solarWatts / 90))) : 0;
  const loadCount = loadWatts > 5 ? Math.min(4, Math.max(1, Math.round(loadWatts / 30))) : 0;
  const solarSpeed = solarWatts > 0 ? Math.max(1.2, 4 - solarWatts / 120) : 4;
  const loadSpeed = loadWatts > 0 ? Math.max(1.2, 4 - loadWatts / 60) : 4;

  return (
    <div className="relative">
      <svg viewBox="0 0 520 200" className="h-auto w-full" aria-hidden="true">
        <path d={SOLAR_TO_BATTERY_PATH} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={2} />
        <path d={BATTERY_TO_LOAD_PATH} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={2} />
        <path d={LOAD_TO_EXTERNAL_PATH} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={2} strokeDasharray="4 5" />
      </svg>

      <div className="pointer-events-none absolute inset-0">
        {solarCount > 0 && <FlowDots path={SOLAR_TO_BATTERY_PATH} color="#f0a84e" speedSeconds={solarSpeed} reverse={false} count={solarCount} />}
        {loadCount > 0 && (
          <FlowDots path={BATTERY_TO_LOAD_PATH} color="#46d2c4" speedSeconds={loadSpeed} reverse={!charging} count={loadCount} />
        )}
      </div>

      {/* MPPT — a label on the path, not a data node (no MPPT-specific telemetry exists yet) */}
      <div className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-white/5 px-2 py-1" style={{ left: "26%", top: "38%" }}>
        <Cpu size={11} className="text-text-muted" />
        <span className="text-[9px] uppercase tracking-widest text-text-muted">MPPT</span>
      </div>

      {/* Solar */}
      <div className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1" style={{ left: "12.5%", top: "29%" }}>
        <div className="rounded-full bg-solar/15 p-3">
          <Sun size={22} className="text-solar" />
        </div>
        <span className="font-mono text-base tabular-nums text-text-primary md:text-lg">{Math.round(solarWatts)}W</span>
        <span className="text-[10px] uppercase tracking-wide text-text-muted">Solar</span>
      </div>

      {/* Leisure Battery */}
      <div className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1" style={{ left: "40%", top: "54%" }}>
        <div className="rounded-full bg-battery/15 p-4">
          <BatteryMedium size={26} className="text-battery" />
        </div>
        <span className="font-mono text-lg font-semibold tabular-nums text-text-primary md:text-xl">
          {battery ? (battery.soc_pct !== null ? `${Math.round(battery.soc_pct)}%` : `${battery.voltage}V`) : "—"}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-text-muted">
          Leisure Battery · {charging ? "Charging" : "Discharging"}
        </span>
      </div>

      {/* Van Loads */}
      <div className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1" style={{ left: "66%", top: "75%" }}>
        <div className="rounded-full bg-white/10 p-3">
          <HomeIcon size={22} className="text-text-secondary" />
        </div>
        <span className="font-mono text-base tabular-nums text-text-primary md:text-lg">{Math.round(loadWatts)}W</span>
        <span className="text-[10px] uppercase tracking-wide text-text-muted">Van Loads</span>
      </div>

      {/* External Battery — honest stub, not fabricated data. Milestone 6. */}
      <div
        className="absolute flex w-24 -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 text-center opacity-40"
        style={{ left: "86%", top: "54%" }}
      >
        <div className="rounded-full border border-dashed border-white/20 p-3">
          <BatteryWarning size={20} className="text-text-muted" />
        </div>
        <span className="text-[10px] uppercase leading-tight tracking-wide text-text-muted">External Battery</span>
        <span className="text-[9px] leading-tight text-text-muted">Not installed</span>
      </div>
    </div>
  );
}
