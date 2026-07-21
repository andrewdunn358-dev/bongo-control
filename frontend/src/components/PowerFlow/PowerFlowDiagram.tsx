import { Sun, BatteryMedium, Home as HomeIcon, Cpu, BatteryWarning } from "lucide-react";
import { motion } from "framer-motion";
import { useTelemetry } from "../../context/TelemetryContext";
import AnimatedNumber from "../Cards/AnimatedNumber";
import { colors } from "../../theme/colors";

/**
 * Rebuilt on a flexbox row/column layout instead of percentage-based
 * absolute positioning over a fixed viewBox. The old approach tuned
 * percentages against one assumed container width - the moment this
 * sat inside a narrower card, fixed-size text labels had nowhere to
 * go and started overlapping their neighbors. Flex items can't do
 * that: each node gets its own box, sized by its own content, laid
 * out in document flow. Stacks vertically on narrow screens,
 * horizontally on wide ones - the connector between nodes just
 * rotates with it.
 */

function Connector({ color, active, reverse }: { color: string; active: boolean; reverse: boolean }) {
  return (
    <div className="relative mx-auto h-8 w-1 shrink-0 overflow-hidden rounded-full bg-ink/[0.06] lg:mx-0 lg:h-1 lg:w-full lg:flex-1">
      {active && (
        <div
          className="flow-connector-anim absolute inset-x-0 top-0 h-10 w-full lg:inset-y-0 lg:left-0 lg:h-full lg:w-10"
          style={{
            background: `linear-gradient(${reverse ? "0deg" : "180deg"}, transparent, ${color}, transparent)`,
            animation: `flow-connector-v 1.6s linear infinite`,
          }}
        />
      )}
    </div>
  );
}

function SunRays({ spinning }: { spinning: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div
        className="flow-sun-rays-anim h-full w-full rounded-full"
        style={{
          background: `conic-gradient(${colors.solar}55 0deg 18deg, transparent 18deg 45deg, ${colors.solar}55 45deg 63deg, transparent 63deg 90deg, ${colors.solar}55 90deg 108deg, transparent 108deg 135deg, ${colors.solar}55 135deg 153deg, transparent 153deg 180deg, ${colors.solar}55 180deg 198deg, transparent 198deg 225deg, ${colors.solar}55 225deg 243deg, transparent 243deg 270deg, ${colors.solar}55 270deg 288deg, transparent 288deg 315deg, ${colors.solar}55 315deg 333deg, transparent 333deg 360deg)`,
          maskImage: "radial-gradient(circle, transparent 58%, #000 60%, #000 78%, transparent 80%)",
          WebkitMaskImage: "radial-gradient(circle, transparent 58%, #000 60%, #000 78%, transparent 80%)",
          animation: spinning ? "flow-spin 16s linear infinite" : undefined,
        }}
      />
    </div>
  );
}

function BatteryLiquid({ pct, charging }: { pct: number; charging: boolean }) {
  const fillHeight = Math.max(6, Math.min(100, pct));
  return (
    <div className="pointer-events-none absolute inset-1 overflow-hidden rounded-full">
      <div
        className="flow-liquid-anim absolute inset-x-[-25%] bottom-0 rounded-[45%]"
        style={{
          height: `${fillHeight}%`,
          background: `linear-gradient(180deg, ${colors.battery}55, ${colors.battery}22)`,
          animation: charging ? "flow-liquid 4s ease-in-out infinite" : undefined,
        }}
      />
    </div>
  );
}

interface NodeProps {
  icon: React.ReactNode;
  value: React.ReactNode;
  label: string;
  sublabel?: string;
  glowColor: string;
  decoration?: React.ReactNode;
  animatePulse?: boolean;
}

function Node({ icon, value, label, sublabel, glowColor, decoration, animatePulse }: NodeProps) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center lg:gap-2.5">
      <motion.div
        className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full border lg:h-20 lg:w-20"
        style={{ borderColor: `${glowColor}40`, background: `${glowColor}1f` }}
        animate={animatePulse ? { boxShadow: [`0 0 0px ${glowColor}00`, `0 0 26px ${glowColor}55`, `0 0 0px ${glowColor}00`] } : {}}
        transition={{ duration: 2.6, repeat: animatePulse ? Infinity : 0, ease: "easeInOut" }}
      >
        {decoration}
        <span className="relative z-10">{icon}</span>
      </motion.div>
      <div className="min-w-0 break-words font-mono text-xl font-semibold leading-none tracking-[-0.03em] text-ink sm:text-2xl lg:text-3xl">
        {value}
      </div>
      <div className="min-w-0 break-words text-[10px] font-bold uppercase tracking-[0.18em] text-ink/45">
        {label}
        {sublabel && <span className="block text-ink/60">{sublabel}</span>}
      </div>
    </div>
  );
}

export default function PowerFlowDiagram() {
  const { state } = useTelemetry();
  const solarWatts = state.solar?.payload.watts ?? 0;
  const battery = state.battery?.payload;
  const loadWatts = state.energy?.payload.load_watts ?? 0;
  const charging = battery?.charging ?? false;
  const batteryPct = battery?.soc_pct ?? (battery ? Math.min(100, Math.max(0, ((battery.voltage - 11.8) / (14.4 - 11.8)) * 100)) : 0);

  return (
    <div className="relative overflow-hidden rounded-[1.75rem] border border-ink/[0.07] bg-base/55 p-5 shadow-[inset_0_1px_0_rgb(var(--color-ink)/0.07)] sm:p-7">
      {/* Aurora backdrop - slow drifting gradient, purely decorative */}
      <div
        className="flow-aurora-anim pointer-events-none absolute -inset-1/2 opacity-70"
        style={{
          background: `conic-gradient(from 0deg, ${colors.battery}22, transparent 30%, ${colors.solar}18, transparent 60%, ${colors.battery}22)`,
          animation: "flow-aurora 24s linear infinite",
        }}
      />

      <div className="relative flex items-center justify-between gap-2 lg:hidden">
        <div className="flex items-center gap-1.5 rounded-full border border-ink/[0.08] bg-surface-card/85 px-3 py-1.5">
          <Cpu size={11} className="text-ink/40" />
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-ink/45">MPPT</span>
        </div>
      </div>

      <div className="relative flex flex-col items-stretch gap-1 lg:flex-row lg:items-center lg:gap-4">
        <Node
          icon={<Sun size={26} className="text-solar lg:h-8 lg:w-8" />}
          value={<AnimatedNumber value={solarWatts} decimals={0} suffix="W" />}
          label="Solar"
          glowColor={colors.solar}
          decoration={<SunRays spinning={solarWatts > 5} />}
        />

        <Connector color={colors.solar} active={solarWatts > 5} reverse={false} />

        <Node
          icon={<BatteryMedium size={30} className="text-battery lg:h-9 lg:w-9" />}
          value={
            battery ? (
              battery.soc_pct !== null ? (
                <AnimatedNumber value={battery.soc_pct} decimals={0} suffix="%" />
              ) : (
                <AnimatedNumber value={battery.voltage} decimals={2} suffix="V" />
              )
            ) : (
              "—"
            )
          }
          label="Leisure Battery"
          sublabel={battery ? (charging ? "Charging" : "Discharging") : undefined}
          glowColor={colors.battery}
          decoration={<BatteryLiquid pct={batteryPct} charging={charging} />}
          animatePulse={charging}
        />

        <Connector color={colors.battery} active={loadWatts > 5} reverse={!charging} />

        <Node
          icon={<HomeIcon size={24} className="text-ink/70 lg:h-7 lg:w-7" />}
          value={<AnimatedNumber value={loadWatts} decimals={0} suffix="W" />}
          label="Van Loads"
          glowColor="#ffffff"
        />

        <Connector color="#ffffff" active={false} reverse={false} />

        {/* External Battery — honest stub, not fabricated data. Milestone 6. */}
        <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center opacity-40 lg:gap-2.5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-dashed border-ink/20 bg-ink/[0.03] lg:h-20 lg:w-20">
            <BatteryWarning size={20} className="text-ink/40" />
          </div>
          <div className="text-[10px] font-bold uppercase leading-tight tracking-[0.18em] text-ink/40">External Battery</div>
          <div className="text-[9px] leading-tight text-ink/35">Not installed</div>
        </div>
      </div>
    </div>
  );
}
