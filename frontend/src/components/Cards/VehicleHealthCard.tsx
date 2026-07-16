import { Truck, CheckCircle2, AlertCircle } from "lucide-react";
import Card from "./Card";
import { useTelemetry } from "../../context/TelemetryContext";

export default function VehicleHealthCard({ index = 0 }: { index?: number }) {
  const { state } = useTelemetry();
  const vehicle = state.vehicle?.payload;

  return (
    <Card label="Vehicle Health" icon={<Truck size={14} />} accent="vehicle" index={index}>
      {vehicle ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {vehicle.engine_ok ? (
              <CheckCircle2 size={18} className="text-vehicle" />
            ) : (
              <AlertCircle size={18} className="text-alert" />
            )}
            <span className="text-sm text-text-primary">{vehicle.engine_ok ? "Engine OK" : "Engine needs attention"}</span>
          </div>
          <div className="text-sm text-text-secondary">Ignition: {vehicle.ignition_on ? "On" : "Off"}</div>
          <div className="font-mono text-sm tabular-nums text-text-secondary">{vehicle.odometer_km.toLocaleString()} km</div>
        </div>
      ) : (
        <span className="text-sm text-text-muted">Waiting for data...</span>
      )}
    </Card>
  );
}
