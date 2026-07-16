import { useTelemetry } from "../context/TelemetryContext";
import Card from "../components/Cards/Card";

export default function Home() {
  const { state } = useTelemetry();
  const battery = state.battery?.payload;
  const solar = state.solar?.payload;
  const budget = state.system?.payload.power_budget;
  const vehicle = state.vehicle?.payload;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Card title="Power Budget">
        {budget ? (
          <ul className="space-y-1 text-base">
            <li>Heater all night: {budget.heater_all_night_possible ? "Yes" : "No"}</li>
            <li>Estimated runtime: ~{budget.estimated_runtime_hours}h</li>
            <li>Recovery tomorrow: ~{budget.estimated_recovery_tomorrow_pct}%</li>
          </ul>
        ) : (
          <span className="text-white/40">Waiting for data...</span>
        )}
      </Card>

      <Card title="Battery">
        {battery ? `${battery.soc_pct}% · ${battery.voltage}V · ${battery.charging ? "Charging" : "Discharging"}` : "—"}
      </Card>

      <Card title="Solar">{solar ? `${solar.watts}W (${solar.cloud_cover_pct}% cloud cover)` : "—"}</Card>

      <Card title="Vehicle Health">
        {vehicle ? `Engine ${vehicle.engine_ok ? "OK" : "Fault"} · ${vehicle.odometer_km} km` : "—"}
      </Card>

      <Card title="Recent Events">
        <span className="text-white/40">Event log coming in a later sprint.</span>
      </Card>
    </div>
  );
}
