import { useTelemetry } from "../context/TelemetryContext";
import Card from "../components/Cards/Card";

export default function Vehicle() {
  const { state } = useTelemetry();
  const vehicle = state.vehicle?.payload;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Card label="Ignition">{vehicle ? (vehicle.ignition_on ? "On" : "Off") : "—"}</Card>
      <Card label="Odometer">{vehicle ? `${vehicle.odometer_km} km` : "—"}</Card>
      <Card label="Engine">{vehicle ? (vehicle.engine_ok ? "OK" : "Fault") : "—"}</Card>
    </div>
  );
}
