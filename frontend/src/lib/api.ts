import { API_BASE } from '@/lib/config';
import type {
  AiRecommendationsResponse,
  AuthStatus,
  BatteryPayload,
  ConnectivityPayload,
  EnergyPayload,
  EnvironmentPayload,
  HealthResponse,
  HistoryResponse,
  MissionBrief,
  PluginInfo,
  PoiResponse,
  Relay,
  RelayResponse,
  SolarPayload,
  SystemPayload,
  WifiNetwork,
  WifiStatus,
} from '@/lib/types';

const TOKEN_KEY = 'bongo.unlock.token';
export const getToken = () => {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
};
export const setToken = (t: string) => {
  try { localStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ }
};
export const clearToken = () => {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
};

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token) headers.set('X-App-Token', token);

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'same-origin' });
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); if (j?.detail) msg = String(j.detail); } catch { /* ignore */ }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

export { ApiError };

export const api = {
  health: () => request<HealthResponse>('/health'),
  battery: () => request<BatteryPayload>('/battery'),
  solar: () => request<SolarPayload>('/solar'),
  energy: () => request<EnergyPayload>('/energy'),
  environment: () => request<EnvironmentPayload>('/environment'),
  connectivity: () => request<ConnectivityPayload>('/connectivity'),
  system: () => request<SystemPayload>('/system'),

  history: (domain: string, hours = 24, maxPoints?: number) => {
    const qs = new URLSearchParams({ hours: String(hours) });
    if (maxPoints !== undefined) qs.set('max_points', String(maxPoints));
    return request<HistoryResponse>(`/history/${domain}?${qs.toString()}`);
  },

  missionBrief: () => request<MissionBrief>('/intelligence/mission-brief'),

  poiNearby: (params: { radius_m?: number; categories?: string[] } = {}) => {
    const qs = new URLSearchParams();
    if (params.radius_m !== undefined) qs.set('radius_m', String(params.radius_m));
    if (params.categories?.length) qs.set('categories', params.categories.join(','));
    const q = qs.toString();
    return request<PoiResponse>(`/poi/nearby${q ? `?${q}` : ''}`);
  },

  aiNearby: () => request<AiRecommendationsResponse>('/ai/nearby-recommendations'),
  aiStatus: () => request<{ configured: boolean }>('/ai/status'),

  location: () => request<{ latitude: number | null; longitude: number | null; source?: string }>('/location'),
  setLocation: (latitude: number, longitude: number) =>
    request<{ ok: boolean }>('/location/gps', { method: 'POST', body: JSON.stringify({ latitude, longitude }) }),
  ipFallback: () => request<{ ok: boolean }>('/location/ip-fallback', { method: 'POST' }),

  relays: () => request<RelayResponse>('/relays'),
  setRelay: (id: number, on: boolean) =>
    request<RelayResponse>(`/relays/${encodeURIComponent(id)}/set`, { method: 'POST', body: JSON.stringify({ on }) }),
  toggleRelay: (id: number) =>
    request<RelayResponse>(`/relays/${encodeURIComponent(id)}/toggle`, { method: 'POST' }),
  relaysAllOff: () => request<{ ok: boolean }>('/relays/all-off', { method: 'POST' }),

  // Camera URLs (used by <img src>). Token appended as ?token= because
  // <img> cannot send X-App-Token as a header.
  cameraSnapshotUrl: (bustCache?: number) => {
    const t = getToken();
    const qs = new URLSearchParams();
    if (t) qs.set('token', t);
    if (bustCache) qs.set('_', String(bustCache));
    const q = qs.toString();
    return `${API_BASE}/camera/snapshot${q ? `?${q}` : ''}`;
  },
  cameraStreamUrl: () => {
    const t = getToken();
    return `${API_BASE}/camera/stream${t ? `?token=${encodeURIComponent(t)}` : ''}`;
  },

  authStatus: () => request<AuthStatus>('/auth/status'),
  unlock: (password: string) =>
    request<{ token: string }>('/auth/unlock', { method: 'POST', body: JSON.stringify({ password }) }),

  wifiStatus: () => request<WifiStatus>('/wifi/status'),
  wifiScan: () => request<{ networks: WifiNetwork[] }>('/wifi/scan'),
  wifiConnect: (ssid: string, password?: string) =>
    request<{ ok: boolean; connected_to: string; ip: string }>('/wifi/connect', {
      method: 'POST',
      body: JSON.stringify({ ssid, password }),
    }),

  plugins: () => request<PluginInfo[]>('/plugins'),
  settings: () => request<{ theme: string; nearby_radius_m?: number }>('/settings'),
};
