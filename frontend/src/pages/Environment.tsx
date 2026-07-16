import { Thermometer, Droplet } from "lucide-react";
import { useTelemetry } from "../context/TelemetryContext";
import MetricCard from "../components/Cards/MetricCard";

export default function Environment() {
  const { state } = useTelemetry();
  const env = state.environment?.payload;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <MetricCard index={0} label="Internal Temp" icon={<Thermometer size={14} />} value={env ? `${Math.round(env.internal_temp_c)}°C` : "—"} />
      <MetricCard index={1} label="External Temp" icon={<Thermometer size={14} />} value={env ? `${Math.round(env.external_temp_c)}°C` : "—"} />
      <MetricCard index={2} label="Humidity" icon={<Droplet size={14} />} value={env ? `${env.humidity_pct}%` : "—"} />
    </div>
  );
}
