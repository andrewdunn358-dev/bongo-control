import { Key, Gauge, CheckCircle2, AlertCircle } from "lucide-react";
import { useTelemetry } from "../context/TelemetryContext";
import MetricCard from "../components/Cards/MetricCard";

export default function Vehicle() {
  const { state } = useTelemetry();
  const vehicle = state.vehicle?.payload;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <MetricCard index={0} label="Ignition" icon={<Key size={14} />} value={vehicle ? (vehicle.ignition_on ? "On" : "Off") : "—"} />
      <MetricCard
        index={1}
        label="Odometer"
        icon={<Gauge size={14} />}
        value={vehicle ? `${vehicle.odometer_km.toLocaleString()} km` : "—"}
      />
      <MetricCard
        index={2}
        label="Engine"
        icon={vehicle?.engine_ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
        accent={vehicle ? (vehicle.engine_ok ? "vehicle" : "alert") : "neutral"}
        value={vehicle ? (vehicle.engine_ok ? "OK" : "Fault") : "—"}
      />
    </div>
  );
}
