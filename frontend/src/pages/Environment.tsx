import { Thermometer, Droplet } from "lucide-react";
import { useTelemetry } from "../context/TelemetryContext";
import MetricCard from "../components/Cards/MetricCard";
import Card from "../components/Cards/Card";

export default function Environment() {
  const { state } = useTelemetry();
  const env = state.environment?.payload;

  if (!env) {
    return (
      <Card label="Environment" icon={<Thermometer size={14} />}>
        <p className="text-sm text-text-muted">
          No environment sensor connected — temperature and humidity readings will appear here once one is wired up.
        </p>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <MetricCard index={0} label="Internal Temp" icon={<Thermometer size={14} />} value={env.internal_temp_c} unit="°C" />
      <MetricCard index={1} label="External Temp" icon={<Thermometer size={14} />} value={env.external_temp_c} unit="°C" />
      <MetricCard index={2} label="Humidity" icon={<Droplet size={14} />} value={env.humidity_pct} unit="%" />
    </div>
  );
}
