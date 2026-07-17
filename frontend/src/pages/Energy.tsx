import { Sun, BatteryMedium, Gauge, Zap } from "lucide-react";
import { useTelemetry } from "../context/TelemetryContext";
import MetricCard from "../components/Cards/MetricCard";
import Card from "../components/Cards/Card";
import StatRow from "../components/Cards/StatRow";

export default function Energy() {
  const { state } = useTelemetry();
  const energy = state.energy?.payload;
  const net = energy?.net_watts ?? 0;

  if (!energy) {
    return (
      <Card label="Energy" icon={<Zap size={14} />}>
        <p className="text-sm text-text-muted">
          No full energy-flow data yet — this needs both a solar controller and a battery shunt to measure production
          and load together. With just a solar controller connected, check Solar and Battery individually instead.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard index={0} label="Solar In" icon={<Sun size={14} />} accent="solar" value={energy.solar_watts} unit="W" />
        <MetricCard index={1} label="Loads Out" icon={<BatteryMedium size={14} />} accent="battery" value={energy.load_watts} unit="W" />
        <MetricCard
          index={2}
          label="Net"
          icon={<Gauge size={14} />}
          value={Math.abs(net)}
          prefix={net >= 0 ? "+" : "-"}
          unit="W"
          subtext={net >= 0 ? "Charging" : "Discharging"}
        />
      </div>

      <Card label="Active Loads" icon={<Zap size={14} />} index={3}>
        <div>
          {Object.entries(energy.loads).map(([name, on]) => (
            <StatRow key={name} label={name.replace(/_/g, " ")} value={on ? "On" : "Off"} dotColor={on ? "bg-battery" : "bg-white/20"} />
          ))}
        </div>
      </Card>
    </div>
  );
}
