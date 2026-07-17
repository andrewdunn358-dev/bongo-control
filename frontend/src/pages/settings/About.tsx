import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import Card from "../../components/Cards/Card";
import StatRow from "../../components/Cards/StatRow";
import { api } from "../../services/api";

interface SettingsResponse {
  app_name: string;
  environment: string;
  mode: "simulation" | "live_hardware" | "none";
}

function formatMode(mode: string): string {
  if (mode === "live_hardware") return "Live hardware";
  if (mode === "simulation") return "Simulation";
  return "None active";
}

export default function About() {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api
      .settings()
      .then((data) => setSettings(data as unknown as SettingsResponse))
      .catch(() => setError(true));
  }, []);

  return (
    <Card label="About" icon={<Info size={14} />} accent={error ? "alert" : "neutral"}>
      {error && <span className="text-sm text-alert">Could not reach backend</span>}
      {settings && (
        <div>
          <StatRow label="Name" value={settings.app_name} />
          <StatRow label="Environment" value={settings.environment} />
          <StatRow label="Mode" value={formatMode(settings.mode)} />
        </div>
      )}
    </Card>
  );
}
