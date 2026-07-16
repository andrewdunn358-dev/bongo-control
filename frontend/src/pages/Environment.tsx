import { useTelemetry } from "../context/TelemetryContext";
import Card from "../components/Cards/Card";

export default function Environment() {
  const { state } = useTelemetry();
  const env = state.environment?.payload;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Card label="Internal Temp">{env ? `${env.internal_temp_c}°C` : "—"}</Card>
      <Card label="External Temp">{env ? `${env.external_temp_c}°C` : "—"}</Card>
      <Card label="Humidity">{env ? `${env.humidity_pct}%` : "—"}</Card>
    </div>
  );
}
