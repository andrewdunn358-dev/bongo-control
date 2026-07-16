import { useTelemetry } from "../context/TelemetryContext";
import Card from "../components/Cards/Card";

export default function Environment() {
  const { state } = useTelemetry();
  const env = state.environment?.payload;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Card title="Internal Temp">{env ? `${env.internal_temp_c}°C` : "—"}</Card>
      <Card title="External Temp">{env ? `${env.external_temp_c}°C` : "—"}</Card>
      <Card title="Humidity">{env ? `${env.humidity_pct}%` : "—"}</Card>
    </div>
  );
}
