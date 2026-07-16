import { Sun, CloudSun, Gauge, Zap, AlertTriangle, BatteryCharging } from "lucide-react";
import { useTelemetry } from "../context/TelemetryContext";
import MetricCard from "../components/Cards/MetricCard";

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function Solar() {
  const { state } = useTelemetry();
  const solar = state.solar?.payload;

  // cloud_cover_pct only exists in simulation (no real cloud sensor);
  // charge_state/charger_error/yield_today_wh only exist on real
  // hardware (the MPPT reports these, simulation doesn't model them).
  const hasCloudData = solar?.cloud_cover_pct !== undefined;
  const hasHardwareData = solar?.charge_state !== undefined || solar?.yield_today_wh !== undefined;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <MetricCard index={0} label="Current Output" icon={<Sun size={14} />} accent="solar" value={solar ? `${Math.round(solar.watts)}W` : "—"} />
      <MetricCard
        index={1}
        label="Peak Today"
        icon={<Gauge size={14} />}
        accent="solar"
        value={solar ? `${Math.round(solar.peak_today_watts)}W` : "—"}
      />

      {hasCloudData && (
        <MetricCard index={2} label="Cloud Cover" icon={<CloudSun size={14} />} value={`${Math.round(solar!.cloud_cover_pct!)}%`} />
      )}

      {hasHardwareData && (
        <>
          <MetricCard
            index={3}
            label="Charge Stage"
            icon={<BatteryCharging size={14} />}
            accent="battery"
            value={solar?.charge_state ? titleCase(solar.charge_state) : "—"}
          />
          {solar?.yield_today_wh != null && (
            <MetricCard index={4} label="Yield Today" icon={<Zap size={14} />} accent="solar" value={`${Math.round(solar.yield_today_wh)}Wh`} />
          )}
          {solar?.charger_error && (
            <MetricCard
              index={5}
              label="Charger Error"
              icon={<AlertTriangle size={14} />}
              accent="alert"
              value={titleCase(solar.charger_error)}
            />
          )}
        </>
      )}
    </div>
  );
}
