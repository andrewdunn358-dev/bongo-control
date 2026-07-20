import { Sun, CloudSun, Gauge, Zap, AlertTriangle, BatteryCharging } from "lucide-react";
import { useTelemetry } from "../context/TelemetryContext";
import MetricCard from "../components/Cards/MetricCard";
import Card from "../components/Cards/Card";

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

  if (!solar) {
    return (
      <Card label="Solar" icon={<Sun size={14} />}>
        <p className="text-sm text-text-muted">
          No solar controller connected — enable the Simulation or Victron MPPT plugin in Settings → Plugins to see
          readings here.
        </p>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <MetricCard index={0} label="Current Output" icon={<Sun size={14} />} accent="solar" value={solar.watts} unit="W" />
      <MetricCard index={1} label="Peak Today" icon={<Gauge size={14} />} accent="solar" value={solar.peak_today_watts} unit="W" />

      {hasCloudData && (
        <MetricCard index={2} label="Cloud Cover" icon={<CloudSun size={14} />} value={solar.cloud_cover_pct!} unit="%" />
      )}

      {hasHardwareData && (
        <>
          <MetricCard
            index={3}
            label="Charge Stage"
            icon={<BatteryCharging size={14} />}
            accent="battery"
            value={solar.charge_state ? titleCase(solar.charge_state) : "—"}
          />
          {solar.yield_today_wh != null && (
            <MetricCard index={4} label="Yield Today" icon={<Zap size={14} />} accent="solar" value={solar.yield_today_wh} unit="Wh" />
          )}
          {solar.charger_error && (
            <MetricCard
              index={5}
              label="Charger Error"
              icon={<AlertTriangle size={14} />}
              accent="alert"
              value={titleCase(solar.charger_error)}
            />
          )}
          {solar.load_power_w != null && (
            <MetricCard
              index={6}
              label="Load via MPPT"
              icon={<Zap size={14} />}
              value={solar.load_power_w}
              unit="W"
              subtext={solar.load_current_a != null ? `${solar.load_current_a} A` : undefined}
            />
          )}
        </>
      )}
    </div>
  );
}
