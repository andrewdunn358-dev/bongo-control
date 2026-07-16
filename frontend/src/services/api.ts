// Thin REST client. Used for things that don't need to be realtime
// (health check, settings, history queries) — live dashboard data comes
// from the WebSocket stream via TelemetryContext, not from here.

const API_BASE = import.meta.env.VITE_API_URL ?? `http://${window.location.hostname}:8000`;

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`API request failed: ${path} (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<Record<string, unknown>>("/api/health"),
  settings: () => request<Record<string, unknown>>("/api/settings"),
  history: (domain: string) => request<unknown[]>(`/api/history/${domain}`),
};
