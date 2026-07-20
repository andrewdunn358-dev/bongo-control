// Thin REST client. Used for things that don't need to be realtime
// (health check, settings, history queries, plugin management, config)
// — live dashboard data comes from the WebSocket stream via
// TelemetryContext, not from here.

// Same-origin relative paths: nginx proxies /api through to the backend.
// This is deliberate - it means the dashboard works identically on the
// van's LAN with no internet and through a remote HTTPS tunnel, with no
// build-time configuration and nothing that can point somewhere
// unreachable when offline.
const API_BASE = "";
const TOKEN_STORAGE_KEY = "bongo-app-token";

export function getStoredAppToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredAppToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // best effort - if storage is unavailable, the unlock just won't persist across reloads
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getStoredAppToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("X-App-Token", token);

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
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
  device_name?: string | null;
  mac_address?: string | null;
}

export interface ScanResult {
  mac_address: string;
  name: string | null;
  rssi: number;
  is_instant_readout: boolean;
  decrypt_success: boolean | null;
  model_name: string | null;
}

export const api = {
  health: () => request<Record<string, unknown>>("/api/health"),
  settings: () => request<Record<string, unknown>>("/api/settings"),
  history: (domain: string, hours = 24) => request<unknown[]>(`/api/history/${domain}?hours=${hours}`),

  plugins: {
    list: () => request<PluginHealth[]>("/api/plugins"),
    enable: (name: string) => request<{ name: string; enabled: boolean }>(`/api/plugins/${name}/enable`, { method: "POST" }),
    disable: (name: string) => request<{ name: string; enabled: boolean }>(`/api/plugins/${name}/disable`, { method: "POST" }),
    getConfig: (name: string) => request<Record<string, unknown>>(`/api/plugins/${name}/config`),
    setConfig: (name: string, config: Record<string, unknown>) =>
      request<Record<string, unknown>>(`/api/plugins/${name}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      }),
    scan: (name: string, duration = 8) =>
      request<ScanResult[]>(`/api/plugins/${name}/scan?duration=${duration}`, { method: "POST" }),
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

  auth: {
    status: () => request<{ required: boolean }>("/api/auth/status"),
    unlock: (password: string) =>
      request<{ token: string }>("/api/auth/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      }),
  },

  location: {
    get: () => request<{ latitude: number; longitude: number; source: string; updated_at: number; city?: string; country?: string }>("/api/location"),
    setGps: (latitude: number, longitude: number) =>
      request<Record<string, unknown>>("/api/location/gps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latitude, longitude }),
      }),
    refreshIpFallback: () => request<Record<string, unknown>>("/api/location/ip-fallback", { method: "POST" }),
  },

  wifi: {
    status: () => request<{ connected: boolean; ssid: string | null; signal: number | null; known_networks: string[] }>("/api/wifi/status"),
    scan: () => request<{ ssid: string; signal: number | null; secured: boolean; active: boolean }[]>("/api/wifi/scan"),
    connect: (ssid: string, password?: string) =>
      request<{ connected: boolean; ssid: string | null; signal: number | null }>("/api/wifi/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ssid, password: password || null }),
      }),
  },

  ai: {
    status: () => request<{ configured: boolean }>("/api/ai/status"),
    nearbyRecommendations: () =>
      request<{
        place_name: string | null;
        recommendations: { name: string; description: string; category: string }[];
        from_cache: boolean;
        cached_at: number | null;
      }>("/api/ai/nearby-recommendations"),
  },
  relays: {
    list: () =>
      request<{
        available: boolean;
        reason: string | null;
        state_is_commanded_only: boolean;
        channels: { id: number; gpio: number; name: string; commanded_on: boolean }[];
      }>("/api/relays"),
    set: (id: number, on: boolean) =>
      request<{ channels: { id: number; gpio: number; name: string; commanded_on: boolean }[] }>(`/api/relays/${id}/set`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on }),
      }),
    allOff: () => request<{ channels: { id: number; commanded_on: boolean }[] }>("/api/relays/all-off", { method: "POST" }),
  },

  intelligence: {
    missionBrief: () =>
      request<{
        status: "green" | "amber" | "red";
        summary: string;
        recommendations: string[];
        predictions: { key: string; label: string; value: number | null; unit: string | null; confidence: string | null }[];
        signals: { source: string; severity: string; message: string; weight: number }[];
        computed_at: number;
      }>("/api/intelligence/mission-brief"),
  },
  poi: {
    nearby: (radiusM: number, categories: string[]) =>
      request<{
        results: {
          id: number;
          category: string;
          name: string | null;
          latitude: number;
          longitude: number;
          opening_hours: string | null;
          fee: string | null;
          address: string | null;
          phone: string | null;
          website: string | null;
        }[];
        from_cache: boolean;
        cached_at: number | null;
      }>(`/api/poi/nearby?radius_m=${radiusM}&categories=${categories.join(",")}`),
  },
};
