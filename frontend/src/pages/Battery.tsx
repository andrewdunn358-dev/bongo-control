import { useTelemetry } from "../context/TelemetryContext";
import Card from "../components/Cards/Card";

export default function Battery() {
  const { state } = useTelemetry();
  const battery = state.battery?.payload;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Card label="State of Charge">{battery ? `${battery.soc_pct}%` : "—"}</Card>
      <Card label="Voltage">{battery ? `${battery.voltage}V` : "—"}</Card>
      <Card label="Status">{battery ? (battery.charging ? "Charging" : "Discharging") : "—"}</Card>
    </div>
  );
}
