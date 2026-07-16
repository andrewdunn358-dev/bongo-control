// Thin REST client. Used for things that don't need to be realtime
// (health check, settings, history queries, plugin management, config)
// — live dashboard data comes from the WebSocket stream via
// TelemetryContext, not from here.

const API_BASE = import.meta.env.VITE_API_URL ?? `http://${window.location.hostname}:8000`;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    throw new Error(`API request failed: ${path} (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export interface PluginHealth {
  name: string;
  display_name: string;
  version: string;
  status: string;
  last_heartbeat: number | null;
  last_error: string | null;
  enabled: boolean;
}

export const api = {
  health: () => request<Record<string, unknown>>("/api/health"),
  settings: () => request<Record<string, unknown>>("/api/settings"),
  history: (domain: string) => request<unknown[]>(`/api/history/${domain}`),

  plugins: {
    list: () => request<PluginHealth[]>("/api/plugins"),
    enable: (name: string) => request<{ name: string; enabled: boolean }>(`/api/plugins/${name}/enable`, { method: "POST" }),
    disable: (name: string) => request<{ name: string; enabled: boolean }>(`/api/plugins/${name}/disable`, { method: "POST" }),
  },

  config: {
    get: (section: string) => request<Record<string, unknown>>(`/api/config/${section}`),
    set: (section: string, value: Record<string, unknown>) =>
      request<Record<string, unknown>>(`/api/config/${section}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      }),
  },
};
