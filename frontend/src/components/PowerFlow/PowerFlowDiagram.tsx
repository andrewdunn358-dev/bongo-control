import { Sun, BatteryMedium, Home as HomeIcon, Cpu, BatteryWarning } from "lucide-react";
import { motion } from "framer-motion";
import { useTelemetry } from "../../context/TelemetryContext";
import AnimatedNumber from "../Cards/AnimatedNumber";

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
            boxShadow: `0 0 14px ${color}`,
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
    <div className="relative min-h-[260px] overflow-hidden rounded-[1.75rem] border border-white/[0.06] bg-[#0B0E12]/55 px-2 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_42%_50%,rgba(0,194,168,0.14),transparent_28rem)]" />
      <svg viewBox="0 0 520 200" className="relative h-auto w-full" aria-hidden="true">
        <path d={SOLAR_TO_BATTERY_PATH} fill="none" stroke="rgba(0,194,168,0.22)" strokeWidth={3} />
        <path d={BATTERY_TO_LOAD_PATH} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth={3} />
        <path d={LOAD_TO_EXTERNAL_PATH} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth={2} strokeDasharray="4 5" />
      </svg>

      <div className="pointer-events-none absolute inset-0">
        {solarCount > 0 && <FlowDots path={SOLAR_TO_BATTERY_PATH} color="#FFB000" speedSeconds={solarSpeed} reverse={false} count={solarCount} />}
        {loadCount > 0 && (
          <FlowDots path={BATTERY_TO_LOAD_PATH} color="#00C2A8" speedSeconds={loadSpeed} reverse={!charging} count={loadCount} />
        )}
      </div>

      {/* MPPT — a label on the path, not a data node (no MPPT-specific telemetry exists yet) */}
      <div className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full border border-white/[0.08] bg-[#151A21]/85 px-3 py-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.24)]" style={{ left: "26%", top: "38%" }}>
        <Cpu size={11} className="text-white/38" />
        <span className="text-[9px] font-bold uppercase tracking-[0.22em] text-white/42">MPPT</span>
      </div>

      {/* Solar */}
      <div className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5" style={{ left: "12.5%", top: "29%" }}>
        <div className="rounded-full border border-[#FFB000]/25 bg-[#FFB000]/15 p-4 shadow-[0_0_28px_rgba(255,176,0,0.16)]">
          <Sun size={24} className="text-[#FFB000]" />
        </div>
        <span className="font-mono text-2xl font-semibold tabular-nums text-white md:text-3xl">
          <AnimatedNumber value={solarWatts} decimals={0} suffix="W" />
        </span>
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/38">Solar</span>
      </div>

      {/* Leisure Battery - the hero node, with a gentle glow while charging */}
      <div className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5" style={{ left: "40%", top: "54%" }}>
        <motion.div
          className="rounded-full border border-[#00C2A8]/25 bg-[#00C2A8]/15 p-5 shadow-[0_0_34px_rgba(0,194,168,0.18)]"
          animate={charging ? { boxShadow: ["0 0 0px rgba(0,194,168,0)", "0 0 22px rgba(0,194,168,0.35)", "0 0 0px rgba(0,194,168,0)"] } : {}}
          transition={{ duration: 2.5, repeat: charging ? Infinity : 0, ease: "easeInOut" }}
        >
          <BatteryMedium size={30} className="text-[#00C2A8]" />
        </motion.div>
        <span className="font-mono text-3xl font-semibold tabular-nums text-white md:text-4xl">
          {battery ? (
            battery.soc_pct !== null ? (
              <AnimatedNumber value={battery.soc_pct} decimals={0} suffix="%" />
            ) : (
              <AnimatedNumber value={battery.voltage} decimals={2} suffix="V" />
            )
          ) : (
            "—"
          )}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/38">
          Leisure Battery · {charging ? "Charging" : "Discharging"}
        </span>
      </div>

      {/* Van Loads */}
      <div className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5" style={{ left: "66%", top: "75%" }}>
        <div className="rounded-full border border-white/[0.1] bg-white/[0.07] p-4">
          <HomeIcon size={24} className="text-white/58" />
        </div>
        <span className="font-mono text-2xl font-semibold tabular-nums text-white md:text-3xl">
          <AnimatedNumber value={loadWatts} decimals={0} suffix="W" />
        </span>
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/38">Van Loads</span>
      </div>

      {/* External Battery — honest stub, not fabricated data. Milestone 6. */}
      <div
        className="absolute flex w-24 -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 text-center opacity-40"
        style={{ left: "86%", top: "54%" }}
      >
        <div className="rounded-full border border-dashed border-white/20 bg-white/[0.03] p-3">
          <BatteryWarning size={20} className="text-white/38" />
        </div>
        <span className="text-[10px] uppercase leading-tight tracking-wide text-text-muted">External Battery</span>
        <span className="text-[9px] leading-tight text-text-muted">Not installed</span>
      </div>
    </div>
  );
}
