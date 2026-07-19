import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, BatteryMedium, Gauge, Sun, Thermometer, Zap } from "lucide-react";
import Card from "../components/Cards/Card";
import LiveIndicator from "../components/Cards/LiveIndicator";
import AnimatedNumber from "../components/Cards/AnimatedNumber";
import PowerFlowDiagram from "../components/PowerFlow/PowerFlowDiagram";
import PowerBudgetCard from "../components/Cards/PowerBudgetCard";
import RecentEventsCard from "../components/Cards/RecentEventsCard";
import { useTelemetry } from "../context/TelemetryContext";
import { colors } from "../theme/colors";

function formatClock(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatStatus(s?: string | null): string {
  if (!s) return "Standby";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function temperatureState(temp?: number): { label: string; color: string } {
  if (temp === undefined) return { label: "Awaiting", color: "text-white/42" };
  if (temp < 4 || temp > 32) return { label: "Extreme", color: "text-alert" };
  if (temp < 10 || temp > 27) return { label: "Watch", color: "text-solar" };
  return { label: "Comfort", color: "text-success" };
}

function batteryStatus(soc: number | null | undefined, voltage: number | undefined): { label: string; tone: "ready" | "charging" | "warning" | "critical" } {
  if (soc !== null && soc !== undefined) {
    if (soc <= 10) return { label: "Critical", tone: "critical" };
    if (soc <= 25) return { label: "Low", tone: "warning" };
    return { label: "Healthy", tone: "ready" };
  }
  if (voltage !== undefined) {
    if (voltage < 11.8) return { label: "Critical voltage", tone: "critical" };
    if (voltage < 12.1) return { label: "Low voltage", tone: "warning" };
    return { label: "Voltage OK", tone: "ready" };
  }
  return { label: "Awaiting", tone: "warning" };
}

function ringColor(tone: "ready" | "charging" | "warning" | "critical") {
  if (tone === "critical") return colors.alert;
  if (tone === "warning") return colors.solar;
  if (tone === "charging") return colors.success;
  return colors.battery;
}

function BatteryGauge({ value, charging }: { value: number | null | undefined; charging: boolean }) {
  const pct = value ?? 0;
  const circumference = 2 * Math.PI * 44;
  const dash = circumference * Math.max(0, Math.min(100, pct)) / 100;

  return (
    <div className={`relative mx-auto flex h-44 w-44 items-center justify-center rounded-full ${charging ? "charging-glow" : ""}`}>
      <svg viewBox="0 0 120 120" className="absolute inset-0 h-full w-full -rotate-90">
        <circle cx="60" cy="60" r="44" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="9" />
        <circle
          cx="60"
          cy="60"
          r="44"
          fill="none"
          stroke={charging ? colors.success : colors.battery}
          strokeWidth="9"
          strokeDasharray={`${dash} ${circumference}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="text-center">
        <div className="font-mono text-5xl font-semibold tracking-[-0.08em] text-white tabular-nums">
          {value !== null && value !== undefined ? <AnimatedNumber value={value} decimals={0} suffix="%" /> : "—"}
        </div>
        <div className="mt-2 text-[0.65rem] font-bold uppercase tracking-[0.24em] text-white/40">Leisure</div>
      </div>
    </div>
  );
}

function SystemPill({ label, value, tone = "ready" }: { label: string; value: string; tone?: "ready" | "charging" | "warning" | "critical" }) {
  const color = ringColor(tone);
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.045] px-4 py-3">
      <div className="text-[0.62rem] font-bold uppercase tracking-[0.22em] text-white/36">{label}</div>
      <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-white">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 14px ${color}` }} />
        {value}
      </div>
    </div>
  );
}

export default function Home() {
  const { state, connected, notifications } = useTelemetry();
  const [now, setNow] = useState(() => new Date());
  const battery = state.battery?.payload;
  const solar = state.solar?.payload;
  const environment = state.environment?.payload;
  const connectivity = state.connectivity?.payload;
  const energy = state.energy?.payload;

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(interval);
  }, []);

  const lastUpdated =
    Math.max(
      0,
      ...Object.values(state)
        .map((m) => m?.timestamp)
        .filter((t): t is number => typeof t === "number")
    ) || null;

  const activeWarning = notifications.find((entry) => ["warning", "error"].includes(entry.message.payload.level));
  const batt = batteryStatus(battery?.soc_pct, battery?.voltage);
  const solarError = Boolean(solar?.charger_error);
  const charging = Boolean(battery?.charging || (solar?.watts ?? 0) > 25);
  const climate = temperatureState(environment?.internal_temp_c);

  const sitRep = useMemo(() => {
    if (!connected) return { state: "WARNING", line: "Telemetry link interrupted", tone: "warning" as const };
    if (activeWarning?.message.payload.level === "error" || batt.tone === "critical" || solarError) {
      return { state: "CRITICAL", line: "Immediate system attention required", tone: "critical" as const };
    }
    if (activeWarning || batt.tone === "warning") return { state: "LOW POWER", line: "Conserve power and review systems", tone: "warning" as const };
    if (charging) return { state: "CHARGING", line: "Solar input is feeding the leisure system", tone: "charging" as const };
    if ((energy?.load_watts ?? 0) > 20) return { state: "CAMPING", line: "Cabin systems active and stable", tone: "ready" as const };
    return { state: "READY", line: "Primary vehicle systems nominal", tone: "ready" as const };
  }, [activeWarning, batt.tone, charging, connected, energy?.load_watts, solarError]);

  const sitRepColor = ringColor(sitRep.tone);
  const batteryPrimary = battery?.soc_pct !== null && battery?.soc_pct !== undefined ? battery.soc_pct : null;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-[2rem] border border-white/[0.07] bg-surface-card/58 px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-sm">
        <div>
          <div className="text-[0.68rem] font-bold uppercase tracking-[0.28em] text-battery">Mazda Bongo</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-white md:text-4xl">Expedition Control</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden rounded-full border border-white/[0.08] bg-white/[0.04] px-4 py-2 font-mono text-lg font-semibold text-white sm:block">
            {formatClock(now)}
          </div>
          <LiveIndicator lastUpdated={lastUpdated} connected={connected} />
        </div>
      </header>

      <Card label="Energy Flow" icon={<Zap size={16} />} accent="battery" index={0}>
        <PowerFlowDiagram />
      </Card>

      <section className="vehicle-panel min-h-[40vh] rounded-[2.4rem] p-5 sm:p-7 xl:p-9">
        <div className="grid min-h-[34vh] gap-7 xl:grid-cols-[1.05fr_0.95fr] xl:items-stretch">
          <div className="flex min-w-0 flex-col justify-between gap-8">
            <div className="min-w-0">
              <div className="flex items-center gap-3 text-[0.7rem] font-bold uppercase tracking-[0.28em] text-white/42">
                <Gauge size={15} className="text-battery" /> SIT REP
              </div>
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-7 break-words text-4xl font-semibold leading-none tracking-[-0.06em] text-white sm:text-6xl md:text-7xl xl:text-9xl xl:tracking-[-0.09em]"
              >
                {sitRep.state}
              </motion.div>
              <div className="mt-5 flex items-start gap-3 text-xl font-medium text-white/62 md:text-2xl">
                <span
                  className="mt-2 h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: sitRepColor, boxShadow: `0 0 22px ${sitRepColor}` }}
                />
                <span className="min-w-0 flex-1 break-words">{sitRep.line}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <SystemPill label="Battery" value={batt.label} tone={battery?.charging ? "charging" : batt.tone} />
              <SystemPill label="Solar" value={solarError ? "Fault" : solar ? `${Math.round(solar.watts)} W` : "Awaiting"} tone={solarError ? "critical" : charging ? "charging" : "ready"} />
              <SystemPill label="Cabin" value={climate.label} tone={climate.label === "Extreme" ? "critical" : climate.label === "Watch" ? "warning" : "ready"} />
              <SystemPill label="Link" value={connected ? "Online" : "Offline"} tone={connected ? "ready" : "warning"} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
            <div className="rounded-[2rem] border border-white/[0.07] bg-base/42 p-5 sm:col-span-3 xl:col-span-1">
              <div className="mb-5 flex items-center justify-between">
                <span className="text-[0.68rem] font-bold uppercase tracking-[0.22em] text-white/42">Warnings</span>
                <AlertTriangle size={17} className={activeWarning ? "text-solar" : "text-success"} />
              </div>
              <div className="text-2xl font-semibold tracking-[-0.04em] text-white">
                {activeWarning ? activeWarning.message.payload.title : "No active warnings"}
              </div>
              <p className="mt-3 line-clamp-2 text-sm text-white/48">
                {activeWarning ? activeWarning.message.payload.message : "Vehicle telemetry is stable across monitored systems."}
              </p>
            </div>
            <div className="rounded-[2rem] border border-white/[0.07] bg-base/42 p-5">
              <div className="text-[0.68rem] font-bold uppercase tracking-[0.22em] text-white/42">Net Power</div>
              <div className="mt-4 font-mono text-4xl font-semibold tracking-[-0.07em] text-white tabular-nums">
                {energy ? <AnimatedNumber value={Math.abs(energy.net_watts)} decimals={0} prefix={energy.net_watts >= 0 ? "+" : "-"} suffix="W" /> : "—"}
              </div>
              <div className="mt-2 text-sm font-semibold uppercase tracking-[0.18em] text-white/38">{energy ? (energy.net_watts >= 0 ? "Charging" : "Discharging") : "Awaiting"}</div>
            </div>
            <div className="rounded-[2rem] border border-white/[0.07] bg-base/42 p-5">
              <div className="text-[0.68rem] font-bold uppercase tracking-[0.22em] text-white/42">Signal</div>
              <div className="mt-4 font-mono text-4xl font-semibold tracking-[-0.07em] text-white tabular-nums">
                {connectivity ? <AnimatedNumber value={connectivity.signal_strength_pct} decimals={0} suffix="%" /> : "—"}
              </div>
              <div className="mt-2 text-sm font-semibold uppercase tracking-[0.18em] text-white/38">{connectivity ? formatStatus(connectivity.connection_type) : "Awaiting"}</div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1fr_1fr_1fr]">
        <Card label="Battery" icon={<BatteryMedium size={16} />} accent="battery" index={1} className="min-h-[21rem]">
          <BatteryGauge value={batteryPrimary} charging={Boolean(battery?.charging)} />
          <div className="mt-6 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-2xl bg-white/[0.045] p-3">
              <div className="text-[0.62rem] font-bold uppercase tracking-[0.2em] text-white/36">Voltage</div>
              <div className="mt-2 font-mono text-lg text-white">{battery ? `${battery.voltage.toFixed(2)}V` : "—"}</div>
            </div>
            <div className="rounded-2xl bg-white/[0.045] p-3">
              <div className="text-[0.62rem] font-bold uppercase tracking-[0.2em] text-white/36">Status</div>
              <div className="mt-2 text-sm font-semibold text-white">{battery?.charging ? "Charging" : battery ? "Discharge" : "—"}</div>
            </div>
            <div className="rounded-2xl bg-white/[0.045] p-3">
              <div className="text-[0.62rem] font-bold uppercase tracking-[0.2em] text-white/36">Power</div>
              <div className="mt-2 font-mono text-lg text-white">{battery?.charging_power_w != null ? `${battery.charging_power_w.toFixed(0)}W` : "—"}</div>
            </div>
          </div>
        </Card>

        <Card label="Solar" icon={<Sun size={16} />} accent="solar" index={2} className="min-h-[21rem]">
          <div className="flex h-full flex-col justify-between gap-8">
            <div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="break-words font-mono text-5xl font-semibold leading-none tracking-[-0.06em] text-white tabular-nums sm:text-6xl md:text-7xl">
                    {solar ? <AnimatedNumber value={solar.watts} decimals={0} /> : "—"}
                  </div>
                  <div className="mt-2 text-xl font-semibold uppercase tracking-[0.18em] text-solar">Watts PV</div>
                </div>
                <div className="rounded-full border border-solar/25 bg-solar/12 p-4 shadow-[0_0_30px_rgba(255,176,0,0.12)]">
                  <Sun size={34} className="text-solar" />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-2xl bg-white/[0.045] p-3">
                <div className="text-[0.62rem] font-bold uppercase tracking-[0.2em] text-white/36">Peak</div>
                <div className="mt-2 font-mono text-lg text-white">{solar ? `${Math.round(solar.peak_today_watts)}W` : "—"}</div>
              </div>
              <div className="rounded-2xl bg-white/[0.045] p-3">
                <div className="text-[0.62rem] font-bold uppercase tracking-[0.2em] text-white/36">Yield</div>
                <div className="mt-2 font-mono text-lg text-white">{solar?.yield_today_wh != null ? `${(solar.yield_today_wh / 1000).toFixed(1)}kWh` : "—"}</div>
              </div>
              <div className="rounded-2xl bg-white/[0.045] p-3">
                <div className="text-[0.62rem] font-bold uppercase tracking-[0.2em] text-white/36">Stage</div>
                <div className="mt-2 truncate text-sm font-semibold text-white">{formatStatus(solar?.charge_state)}</div>
              </div>
            </div>
          </div>
        </Card>

        <Card label="Temperature" icon={<Thermometer size={16} />} accent="neutral" index={3} className="min-h-[21rem]">
          <div className="flex h-full flex-col justify-between gap-8">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-[0.68rem] font-bold uppercase tracking-[0.22em] text-white/38">Inside</div>
                <div className="mt-3 font-mono text-6xl font-semibold tracking-[-0.09em] text-white tabular-nums">
                  {environment ? <AnimatedNumber value={environment.internal_temp_c} decimals={0} suffix="°" /> : "—"}
                </div>
              </div>
              <div>
                <div className="text-[0.68rem] font-bold uppercase tracking-[0.22em] text-white/38">Outside</div>
                <div className="mt-3 font-mono text-6xl font-semibold tracking-[-0.09em] text-white/70 tabular-nums">
                  {environment ? <AnimatedNumber value={environment.external_temp_c} decimals={0} suffix="°" /> : "—"}
                </div>
              </div>
            </div>
            <div className="rounded-[1.5rem] border border-white/[0.07] bg-white/[0.045] p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-bold uppercase tracking-[0.2em] text-white/40">Cabin state</span>
                <span className={`text-lg font-semibold ${climate.color}`}>{climate.label}</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.08]">
                <div className="h-full rounded-full bg-gradient-to-r from-battery via-success to-solar" style={{ width: environment ? `${Math.min(100, Math.max(0, environment.humidity_pct))}%` : "0%" }} />
              </div>
              <div className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/35">Humidity {environment ? `${Math.round(environment.humidity_pct)}%` : "—"}</div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <PowerBudgetCard index={5} />
        <RecentEventsCard index={6} />
      </div>
    </div>
  );
}
