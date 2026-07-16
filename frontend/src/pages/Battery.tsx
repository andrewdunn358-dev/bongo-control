import { BatteryMedium, Zap, BatteryCharging, Gauge } from "lucide-react";
import { useTelemetry } from "../context/TelemetryContext";
import MetricCard from "../components/Cards/MetricCard";

export default function Battery() {
  const { state } = useTelemetry();
  const battery = state.battery?.payload;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <MetricCard
        index={0}
        label="State of Charge"
        icon={<BatteryMedium size={14} />}
        accent="battery"
        value={battery ? (battery.soc_pct !== null ? `${Math.round(battery.soc_pct)}%` : "—") : "—"}
        subtext={
          battery
            ? battery.soc_pct !== null
              ? battery.charging
                ? "Charging"
                : "Discharging"
              : "No shunt — voltage only"
            : undefined
        }
      />
      <MetricCard index={1} label="Voltage" icon={<Zap size={14} />} value={battery ? `${battery.voltage}V` : "—"} />
      <MetricCard
        index={2}
        label="Status"
        icon={<BatteryCharging size={14} />}
        accent="battery"
        value={battery ? (battery.charging ? "Charging" : "Discharging") : "—"}
      />
      {battery?.charging_power_w != null && (
        <MetricCard index={3} label="Charging Power" icon={<Gauge size={14} />} accent="battery" value={`${battery.charging_power_w}W`} />
      )}
    </div>
  );
}
