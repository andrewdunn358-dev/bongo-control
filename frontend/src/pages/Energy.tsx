import { useTelemetry } from "../context/TelemetryContext";
import Card from "../components/Cards/Card";

export default function Energy() {
  const { state } = useTelemetry();
  const energy = state.energy?.payload;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Card title="Power Flow">
        {energy ? (
          <div className="space-y-1 text-base">
            <div>Solar in: {energy.solar_watts}W</div>
            <div>Loads out: {energy.load_watts}W</div>
            <div>Net: {energy.net_watts}W</div>
          </div>
        ) : (
          "Waiting for data..."
        )}
      </Card>

      <Card title="Active Loads">
        {energy ? (
          <ul className="space-y-1 text-base">
            {Object.entries(energy.loads).map(([name, on]) => (
              <li key={name}>
                {name}: {on ? "On" : "Off"}
              </li>
            ))}
          </ul>
        ) : (
          "—"
        )}
      </Card>
    </div>
  );
}
