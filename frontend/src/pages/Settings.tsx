import { useEffect, useState } from "react";
import Card from "../components/Cards/Card";
import { api } from "../services/api";

interface PluginHealth {
  name: string;
  display_name: string;
  status: string;
}

interface SettingsResponse {
  app_name: string;
  environment: string;
  simulation_mode: boolean;
  plugins: PluginHealth[];
}

export default function Settings() {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api
      .settings()
      .then((data) => setSettings(data as unknown as SettingsResponse))
      .catch(() => setError(true));
  }, []);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Card label="App">
        {error && <span className="text-red-400">Could not reach backend</span>}
        {settings && (
          <ul className="space-y-1 text-base">
            <li>{settings.app_name}</li>
            <li>Environment: {settings.environment}</li>
            <li>Mode: {settings.simulation_mode ? "Simulation" : "Live hardware"}</li>
          </ul>
        )}
      </Card>

      <Card label="Plugins">
        {settings ? (
          <ul className="space-y-1 text-base">
            {settings.plugins.map((p) => (
              <li key={p.name}>
                {p.display_name}: {p.status}
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
