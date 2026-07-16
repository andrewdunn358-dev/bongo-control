import { Sun, BatteryMedium, Gauge, Zap } from "lucide-react";
import { useTelemetry } from "../context/TelemetryContext";
import MetricCard from "../components/Cards/MetricCard";
import Card from "../components/Cards/Card";
import StatRow from "../components/Cards/StatRow";

export default function Energy() {
  const { state } = useTelemetry();
  const energy = state.energy?.payload;
  const net = energy?.net_watts ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          index={0}
          label="Solar In"
          icon={<Sun size={14} />}
          accent="solar"
          value={energy ? `${Math.round(energy.solar_watts)}W` : "—"}
        />
        <MetricCard
          index={1}
          label="Loads Out"
          icon={<BatteryMedium size={14} />}
          accent="battery"
          value={energy ? `${Math.round(energy.load_watts)}W` : "—"}
        />
        <MetricCard
          index={2}
          label="Net"
          icon={<Gauge size={14} />}
          value={energy ? `${net >= 0 ? "+" : ""}${Math.round(net)}W` : "—"}
          subtext={energy ? (net >= 0 ? "Charging" : "Discharging") : undefined}
        />
      </div>

      <Card label="Active Loads" icon={<Zap size={14} />} index={3}>
        {energy ? (
          <div>
            {Object.entries(energy.loads).map(([name, on]) => (
              <StatRow key={name} label={name.replace(/_/g, " ")} value={on ? "On" : "Off"} dotColor={on ? "bg-battery" : "bg-white/20"} />
            ))}
          </div>
        ) : (
          <span className="text-sm text-text-muted">Waiting for data...</span>
        )}
      </Card>
    </div>
  );
}
