import { useTelemetry } from "../context/TelemetryContext";
import Card from "../components/Cards/Card";

export default function Connectivity() {
  const { state } = useTelemetry();
  const conn = state.connectivity?.payload;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Card title="Status">{conn ? (conn.online ? "Online" : "Offline") : "—"}</Card>
      <Card title="Signal Strength">{conn ? `${conn.signal_strength_pct}%` : "—"}</Card>
      <Card title="Connection Type">{conn ? conn.connection_type : "—"}</Card>
    </div>
  );
}
