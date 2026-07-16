import { Sun, CloudSun, Gauge } from "lucide-react";
import { useTelemetry } from "../context/TelemetryContext";
import MetricCard from "../components/Cards/MetricCard";

export default function Solar() {
  const { state } = useTelemetry();
  const solar = state.solar?.payload;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <MetricCard index={0} label="Current Output" icon={<Sun size={14} />} accent="solar" value={solar ? `${Math.round(solar.watts)}W` : "—"} />
      <MetricCard index={1} label="Cloud Cover" icon={<CloudSun size={14} />} value={solar ? `${Math.round(solar.cloud_cover_pct)}%` : "—"} />
      <MetricCard
        index={2}
        label="Peak Today"
        icon={<Gauge size={14} />}
        accent="solar"
        value={solar ? `${Math.round(solar.peak_today_watts)}W` : "—"}
      />
    </div>
  );
}
