import { useTelemetry } from "../context/TelemetryContext";
import Card from "../components/Cards/Card";

export default function Solar() {
  const { state } = useTelemetry();
  const solar = state.solar?.payload;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Card label="Current Output">{solar ? `${solar.watts}W` : "—"}</Card>
      <Card label="Cloud Cover">{solar ? `${solar.cloud_cover_pct}%` : "—"}</Card>
      <Card label="Peak Today">{solar ? `${solar.peak_today_watts}W` : "—"}</Card>
    </div>
  );
}
