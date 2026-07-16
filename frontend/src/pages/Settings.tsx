import { useEffect, useState } from "react";
import { Info, Puzzle, Smartphone, CheckCircle2 } from "lucide-react";
import Card from "../components/Cards/Card";
import StatRow from "../components/Cards/StatRow";
import { api } from "../services/api";
import { useInstallPrompt } from "../hooks/useInstallPrompt";

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

function InstallCard({ index }: { index: number }) {
  const { canInstall, installed, isIOS, promptInstall } = useInstallPrompt();

  return (
    <Card label="Install App" icon={<Smartphone size={14} />} accent={installed ? "battery" : "neutral"} index={index}>
      {installed ? (
        <div className="flex items-center gap-2 text-sm text-text-primary">
          <CheckCircle2 size={16} className="text-battery" />
          Installed — running as an app
        </div>
      ) : canInstall ? (
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">Install for a full-screen, app-like experience — no browser bar, launches from your home screen.</p>
          <button
            onClick={promptInstall}
            className="rounded-lg bg-solar px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90"
          >
            Install Bongo Control
          </button>
        </div>
      ) : isIOS ? (
        <p className="text-sm text-text-secondary">
          Tap the <span className="text-text-primary">Share</span> icon in Safari's toolbar, then{" "}
          <span className="text-text-primary">Add to Home Screen</span>. iOS doesn't support one-tap install from the page itself.
        </p>
      ) : (
        <p className="text-sm text-text-secondary">
          Look for an install icon in your browser's address bar, or use its menu → "Install Bongo Control" / "Add to Home Screen".
        </p>
      )}
    </Card>
  );
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
      <InstallCard index={0} />

      <Card label="App" icon={<Info size={14} />} index={1} accent={error ? "alert" : "neutral"}>
        {error && <span className="text-sm text-alert">Could not reach backend</span>}
        {settings && (
          <div>
            <StatRow label="Name" value={settings.app_name} />
            <StatRow label="Environment" value={settings.environment} />
            <StatRow label="Mode" value={settings.simulation_mode ? "Simulation" : "Live hardware"} />
          </div>
        )}
      </Card>

      <Card label="Plugins" icon={<Puzzle size={14} />} index={2}>
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
