import { useEffect, useState } from "react";
import { Info, Puzzle } from "lucide-react";
import Card from "../components/Cards/Card";
import StatRow from "../components/Cards/StatRow";
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
      <Card label="App" icon={<Info size={14} />} index={0} accent={error ? "alert" : "neutral"}>
        {error && <span className="text-sm text-alert">Could not reach backend</span>}
        {settings && (
          <div>
            <StatRow label="Name" value={settings.app_name} />
            <StatRow label="Environment" value={settings.environment} />
            <StatRow label="Mode" value={settings.simulation_mode ? "Simulation" : "Live hardware"} />
          </div>
        )}
      </Card>

      <Card label="Plugins" icon={<Puzzle size={14} />} index={1}>
        {settings ? (
          <div>
            {settings.plugins.map((p) => (
              <StatRow
                key={p.name}
                label={p.display_name}
                value={p.status}
                dotColor={p.status === "running" ? "bg-battery" : p.status === "error" ? "bg-alert" : "bg-white/20"}
              />
            ))}
          </div>
        ) : (
          <span className="text-sm text-text-muted">—</span>
        )}
      </Card>
    </div>
  );
}
