import { Sun, BatteryMedium, Home as HomeIcon } from "lucide-react";
import { useTelemetry } from "../../context/TelemetryContext";

// Path geometry (viewBox 0 0 400 200): Solar (top-left) -> Battery (center)
// -> Load (right). Dots travel along these paths using CSS `offset-path`,
// which is the right tool for continuous looping motion — cheaper and
// smoother than driving it frame-by-frame from React/Framer Motion.
const SOLAR_TO_BATTERY_PATH = "M 70 60 C 130 60, 140 100, 190 100";
const BATTERY_TO_LOAD_PATH = "M 210 100 C 260 100, 270 140, 330 140";

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
      <svg viewBox="0 0 400 200" className="h-auto w-full" aria-hidden="true">
        <path d={SOLAR_TO_BATTERY_PATH} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={2} />
        <path d={BATTERY_TO_LOAD_PATH} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={2} />
      </svg>

      <div className="pointer-events-none absolute inset-0">
        {solarCount > 0 && <FlowDots path={SOLAR_TO_BATTERY_PATH} color="#f0a84e" speedSeconds={solarSpeed} reverse={false} count={solarCount} />}
        {loadCount > 0 && (
          <FlowDots path={BATTERY_TO_LOAD_PATH} color="#46d2c4" speedSeconds={loadSpeed} reverse={!charging} count={loadCount} />
        )}
      </div>

      {/* Nodes, positioned to match the SVG path endpoints as percentages of the viewBox */}
      <div className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1" style={{ left: "17.5%", top: "30%" }}>
        <div className="rounded-full bg-solar/15 p-3">
          <Sun size={22} className="text-solar" />
        </div>
        <span className="font-mono text-sm tabular-nums text-text-primary">{Math.round(solarWatts)}W</span>
        <span className="text-[10px] uppercase tracking-wide text-text-muted">Solar</span>
      </div>

      <div className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1" style={{ left: "50%", top: "50%" }}>
        <div className="rounded-full bg-battery/15 p-4">
          <BatteryMedium size={26} className="text-battery" />
        </div>
        <span className="font-mono text-base font-semibold tabular-nums text-text-primary">{battery ? `${Math.round(battery.soc_pct)}%` : "—"}</span>
        <span className="text-[10px] uppercase tracking-wide text-text-muted">{charging ? "Charging" : "Discharging"}</span>
      </div>

      <div className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1" style={{ left: "82.5%", top: "70%" }}>
        <div className="rounded-full bg-white/10 p-3">
          <HomeIcon size={22} className="text-text-secondary" />
        </div>
        <span className="font-mono text-sm tabular-nums text-text-primary">{Math.round(loadWatts)}W</span>
        <span className="text-[10px] uppercase tracking-wide text-text-muted">Van</span>
      </div>
    </div>
  );
}
