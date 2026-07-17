import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Settings2 } from "lucide-react";
import Card from "../../components/Cards/Card";
import { api, type PluginHealth } from "../../services/api";

function relativeTime(unixSeconds: number | null): string {
  if (unixSeconds === null) return "never";
  const seconds = Math.round(Date.now() / 1000 - unixSeconds);
  if (seconds < 2) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

const statusDot: Record<string, string> = {
  running: "bg-battery",
  starting: "bg-solar",
  stopped: "bg-white/20",
  disabled: "bg-white/20",
  error: "bg-alert",
};

// Plugins with a real configuration surface, and where it lives.
// Simulation has nothing to configure, so it's absent here.
const CONFIG_ROUTES: Record<string, string> = {
  victron_mppt: "/settings/hardware",
};

export default function Plugins() {
  const [plugins, setPlugins] = useState<PluginHealth[]>([]);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    api.plugins
      .list()
      .then(setPlugins)
      .catch(() => setError(true));
  };

  useEffect(() => {
    load();
    // Heartbeats/status can change without the user acting (e.g. a
    // plugin erroring out on its own) — light polling keeps this page
    // honest without needing a dedicated websocket channel for it.
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  const toggle = async (plugin: PluginHealth) => {
    setBusy(plugin.name);
    try {
      if (plugin.enabled) {
        await api.plugins.disable(plugin.name);
      } else {
        await api.plugins.enable(plugin.name);
      }
      load();
    } finally {
      setBusy(null);
    }
  };

  if (error) {
    return (
      <Card label="Plugins">
        <span className="text-sm text-alert">Could not reach backend</span>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {plugins.map((plugin, i) => {
        const configRoute = CONFIG_ROUTES[plugin.name];
        return (
          <Card key={plugin.name} label={plugin.display_name} accent={plugin.status === "error" ? "alert" : "neutral"} index={i}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${statusDot[plugin.status] ?? "bg-white/20"}`} />
                <span className="text-sm text-text-primary capitalize">{plugin.status}</span>
                <span className="text-sm text-text-muted">· v{plugin.version}</span>
                <span className="text-sm text-text-muted">· last update {relativeTime(plugin.last_heartbeat)}</span>
                {plugin.device_name && <span className="text-sm text-text-muted">· {plugin.device_name}</span>}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggle(plugin)}
                  disabled={busy === plugin.name}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-150 active:scale-95 disabled:opacity-50 ${
                    plugin.enabled ? "bg-white/10 text-text-primary hover:bg-white/15" : "bg-solar text-black hover:opacity-90"
                  }`}
                >
                  {plugin.enabled ? "Disable" : "Enable"}
                </button>
                {configRoute ? (
                  <Link
                    to={configRoute}
                    className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-text-primary hover:bg-white/15"
                  >
                    <Settings2 size={14} />
                    Configure
                  </Link>
                ) : (
                  <button
                    disabled
                    title="Nothing to configure for this plugin"
                    className="flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-sm text-text-muted opacity-50"
                  >
                    <Settings2 size={14} />
                    Configure
                  </button>
                )}
              </div>
            </div>
            {plugin.last_error && <div className="mt-2 text-sm text-alert">{plugin.last_error}</div>}
          </Card>
        );
      })}
    </div>
  );
}
