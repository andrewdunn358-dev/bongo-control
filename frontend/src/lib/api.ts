import { API_BASE } from '@/lib/config';
import { isDemo, demoRequest, DEMO_CAM_IMAGE, demoCameraFrame } from '@/lib/demo';
import type {
  AiRecommendationsResponse,
  AuthStatus,
  BatteryPayload,
  ConnectivityPayload,
  CoverageResult,
  CoverageStatus,
  EnergyPayload,
  EnvironmentPayload,
  GpsSatellite,
  HealthResponse,
  HistoryResponse,
  InternetRadioStatus,
  MissionBrief,
  Place,
  PlaceCandidate,
  PluginInfo,
  PoiResponse,
  RadioStation,
  Relay,
  RelayEvent,
  RelayResponse,
  RoofStatus,
  CameraSnapshot,
  SolarPayload,
  SystemPayload,
  TelemetryMessage,
  VoiceControlStatus,
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
  // Static demo build: serve everything from the in-browser simulation.
  if (isDemo) return demoRequest<T>(path, init);
  const headers = new Headers(init.headers || {});
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token) headers.set('X-App-Token', token);

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'same-origin' });
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); if (j?.detail) msg = String(j.detail); } catch { /* ignore */ }
    // A 401 while we DID present a token means the token is stale/revoked
    // (e.g. revoke_all_tokens after a lost phone, or it expired). Clear it
    // and tell AppGate, so the lock screen returns instead of the app
    // silently 401-ing every request forever with no way back.
    if (res.status === 401 && token) {
      clearToken();
      try { window.dispatchEvent(new Event('bongo:unauthorized')); } catch { /* ignore */ }
    }
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
  // The REST snapshot endpoints return the full telemetry envelope
  // ({domain, source, timestamp, payload}), NOT a bare payload — the live
  // WS path is what the screens actually use, but typing these correctly
  // stops a future caller reading data.voltage (which is at data.payload.voltage).
  battery: () => request<TelemetryMessage<BatteryPayload>>('/battery'),
  solar: () => request<TelemetryMessage<SolarPayload>>('/solar'),
  energy: () => request<TelemetryMessage<EnergyPayload>>('/energy'),
  environment: () => request<TelemetryMessage<EnvironmentPayload>>('/environment'),
  connectivity: () => request<TelemetryMessage<ConnectivityPayload>>('/connectivity'),
  system: () => request<TelemetryMessage<SystemPayload>>('/system'),

  history: (domain: string, hours = 24, maxPoints?: number) => {
    const qs = new URLSearchParams({ hours: String(hours) });
    if (maxPoints !== undefined) qs.set('max_points', String(maxPoints));
    return request<HistoryResponse>(`/history/${domain}?${qs.toString()}`);
  },

  missionBrief: () => request<MissionBrief>('/intelligence/mission-brief'),

  poiNearby: (params: { radius_m?: number; categories?: string[]; forceRefresh?: boolean } = {}) => {
    const qs = new URLSearchParams();
    if (params.radius_m !== undefined) qs.set('radius_m', String(params.radius_m));
    if (params.categories?.length) qs.set('categories', params.categories.join(','));
    if (params.forceRefresh) qs.set('force_refresh', 'true');
    const q = qs.toString();
    return request<PoiResponse>(`/poi/nearby${q ? `?${q}` : ''}`);
  },

  // Predicted mobile coverage (Ofcom). Plan-ahead, not live: lookups
  // need internet, results are cached locally for offline reading.
  coverageStatus: () => request<CoverageStatus>('/coverage/status'),
  coverageSearch: (q: string, forceRefresh?: boolean) => {
    const qs = new URLSearchParams({ q });
    if (forceRefresh) qs.set('force_refresh', 'true');
    return request<CoverageResult>(`/coverage/search?${qs.toString()}`);
  },
  coverageAt: (lat: number, lon: number) =>
    request<CoverageResult>(`/coverage/at?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`),
  coverageHere: () => request<CoverageResult>('/coverage/here'),
  // limit is worth raising for the map view - the sidebar list wants a
  // dozen, the map wants everything that's been checked.
  coverageRecent: (limit?: number) =>
    request<{ results: CoverageResult[]; count: number }>(`/coverage/recent${limit ? `?limit=${limit}` : ''}`),
  // A grid of real postcodes around a point - "coverage around here",
  // for wherever the map is centred, not just the van's own spot. See
  // coverage_service.area() for why this is points, not a heatmap blur.
  coverageArea: (lat: number, lon: number, radiusM?: number, limit?: number) => {
    const qs = new URLSearchParams({ lat: String(lat), lon: String(lon) });
    if (radiusM) qs.set('radius_m', String(radiusM));
    if (limit) qs.set('limit', String(limit));
    return request<{ centre: { latitude: number; longitude: number }; radius_m: number; results: CoverageResult[] }>(
      `/coverage/area?${qs.toString()}`,
    );
  },

  // Raw diagnostic reading from the van's own Huawei B525 - see
  // modem_service.py. Not wired into any auto-refreshing query; this is
  // a manual "check now" so a dead/unreachable router doesn't spam logs.
  modemSignal: () => request<{ reachable: boolean; host: string; raw: Record<string, unknown> }>('/modem/signal'),

  voiceControlStatus: () => request<VoiceControlStatus>('/voice-control/status'),
  // Manual test - runs the same record -> transcribe -> act/think ->
  // speak pipeline the wake word normally triggers, without needing
  // the wake word (or a Picovoice key) at all. Records for a few
  // seconds starting the instant this is called - the frontend should
  // prompt the person to start talking right away.
  voiceControlTest: () => request<VoiceControlStatus>('/voice-control/test', { method: 'POST' }),
  // Makes the Pi say the wake word, pause, then this command, through
  // its own speaker - two separate clips with a real gap between them,
  // not one continuous phrase (a single TTS clip has no pause at all,
  // which reliably breaks the recording-timing window - see the
  // backend's own docstring for why). Lets the wake word be tested
  // from anywhere with a connection, no need to be physically in the
  // van to speak it.
  voiceControlSpeakTest: (commandText: string) =>
    request<VoiceControlStatus>('/voice-control/speak-test', {
      method: 'POST',
      body: JSON.stringify({ command_text: commandText }),
    }),

  aiNearby: (forceRefresh?: boolean) =>
    request<AiRecommendationsResponse>(`/ai/nearby-recommendations${forceRefresh ? '?force_refresh=true' : ''}`),
  aiStatus: () => request<{ configured: boolean; persona_name?: string }>('/ai/status'),
  // Full history resent every call - there's no server-side session,
  // see ai_chat_service.py for why that's the deliberate choice.
  aiChat: (messages: { role: 'user' | 'assistant'; content: string }[]) =>
    request<{ reply: string }>('/ai/chat', { method: 'POST', body: JSON.stringify({ messages }) }),

  location: () => request<{ latitude: number | null; longitude: number | null; source?: string; city?: string; country?: string; updated_at?: number; satellites?: number | null; hdop?: number | null }>('/location'),
  setLocation: (latitude: number, longitude: number) =>
    request<{ ok: boolean }>('/location/gps', { method: 'POST', body: JSON.stringify({ latitude, longitude }) }),
  ipFallback: () => request<{ ok: boolean }>('/location/ip-fallback', { method: 'POST' }),
  gpsSatellites: () =>
    request<{ satellites: GpsSatellite[]; count: number }>('/location/satellites'),
  locationHistory: () =>
    request<{ points: { timestamp: number; latitude: number; longitude: number; source: string }[]; count: number }>('/location/history'),
  // Distance is computed on the BACKEND, from the full-resolution
  // trail. /location/history strides its points down before sending,
  // and the distance filters reason about gaps between consecutive
  // points - measured against the real 12k-point table, the decimated
  // trail rejected only 160 bad segments where full resolution caught
  // 3711, because striding merges bad points into longer segments that
  // then look plausible. Same journey, 403.94mi on the phone vs
  // 366.59mi on the full trail.
  // Which capture path is live. The Live toggle is gated on this:
  // without uStreamer, streaming spawns its own ffmpeg and fights
  // snapshot polling for the device, which is exactly why the button
  // was hidden in the first place.
  cameraStatus: () => request<{ ustreamer: { configured: boolean; reachable: boolean; url: string | null; detail?: string | null } }>('/camera/status'),

  tripStats: (opts?: { allTime?: boolean }) => {
    const qs = new URLSearchParams();
    if (opts?.allTime) qs.set('all_time', 'true');
    const q = qs.toString();
    return request<{
      distance_metres: number; points: number; rejected: number; days: number;
      first_timestamp: number | null; last_timestamp: number | null;
      by_day: { day: string; metres: number }[];
      trip_started_at: number | null; measured_from: number | null;
    }>(`/location/trip-stats${q ? `?${q}` : ''}`);
  },
  // Mark where "this trip" starts. Backdatable on purpose: the point
  // of a marker over a delete is that you can set it AFTER the fact -
  // when you realise mid-trip that you'd like to measure it, or when
  // you got home and forgot entirely. Pass null to clear it.
  setTripStart: (startedAt: number | null) =>
    request<{ trip_started_at: number | null }>('/location/trip-start', {
      method: 'PUT',
      body: JSON.stringify({ started_at: startedAt }),
    }),

  // Purge a stretch of breadcrumb history - e.g. erratic fixes in the
  // first days after fitting a new GPS antenna. At least one bound
  // required - the backend refuses an empty call rather than wipe
  // everything.
  deleteLocationHistory: (bounds: { after?: number; before?: number }) => {
    const qs = new URLSearchParams();
    if (bounds.after != null) qs.set('after', String(bounds.after));
    if (bounds.before != null) qs.set('before', String(bounds.before));
    return request<{ deleted: number }>(`/location/history?${qs.toString()}`, { method: 'DELETE' });
  },

  // Places — Trips & Memories Phase 2. "Detected" candidates are computed
  // on demand from the breadcrumb trail and never stored; saving one
  // (naming it) is what creates a Place row.
  places: () => request<{ places: Place[] }>('/places'),
  detectedPlaces: () => request<{ candidates: PlaceCandidate[] }>('/places/detected'),
  createPlace: (place: { name: string; notes?: string; latitude: number; longitude: number; arrived_at: number; departed_at?: number | null }) =>
    request<Place>('/places', { method: 'POST', body: JSON.stringify(place) }),
  updatePlace: (id: number, patch: { name?: string; notes?: string }) =>
    request<Place>(`/places/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(patch) }),
  deletePlace: (id: number) => request<{ ok: boolean }>(`/places/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  relays: () => request<RelayResponse>('/relays'),
  roofStatus: () => request<RoofStatus>('/roof'),
  roofHold: (direction: 'up' | 'down') =>
    request<RoofStatus>('/roof/hold', { method: 'POST', body: JSON.stringify({ direction }) }),
  roofRelease: () => request<RoofStatus>('/roof/release', { method: 'POST' }),

  renameRelay: (id: number, name: string) =>
    request<RelayResponse>(`/relays/${encodeURIComponent(id)}/name`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    }),
  setRelay: (id: number, on: boolean) =>
    request<RelayResponse>(`/relays/${encodeURIComponent(id)}/set`, { method: 'POST', body: JSON.stringify({ on }) }),
  toggleRelay: (id: number) =>
    request<RelayResponse>(`/relays/${encodeURIComponent(id)}/toggle`, { method: 'POST' }),
  relaysAllOff: () => request<{ ok: boolean }>('/relays/all-off', { method: 'POST' }),
  relayEvents: (before?: number) =>
    request<{ events: RelayEvent[]; count: number }>(`/relays/events${before ? `?before=${before}` : ''}`),

  // Camera URLs (used by <img src>). Token appended as ?token= because
  // <img> cannot send X-App-Token as a header.
  cameraSnapshotUrl: (bustCache?: number) => {
    if (isDemo) return demoCameraFrame();
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

  // Saved snapshots (persisted on the Pi). The file URL carries the
  // token as a query param because <img> can't send an X-App-Token
  // header; the POST/DELETE below go through request() which does.
  cameraSnapshotFileUrl: (id: string) => {
    if (isDemo) return DEMO_CAM_IMAGE;
    const t = getToken();
    return `${API_BASE}/camera/snapshots/${encodeURIComponent(id)}${t ? `?token=${encodeURIComponent(t)}` : ''}`;
  },
  saveSnapshot: () => request<CameraSnapshot>('/camera/snapshots', { method: 'POST' }),
  cameraSnapshots: () => request<{ snapshots: CameraSnapshot[] }>('/camera/snapshots'),
  deleteSnapshot: (id: string) =>
    request<void>(`/camera/snapshots/${encodeURIComponent(id)}`, { method: 'DELETE' }),

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
  enablePlugin: (name: string) => request<{ name: string; enabled: boolean }>(`/plugins/${encodeURIComponent(name)}/enable`, { method: 'POST' }),
  disablePlugin: (name: string) => request<{ name: string; enabled: boolean }>(`/plugins/${encodeURIComponent(name)}/disable`, { method: 'POST' }),

  internetRadioStatus: () => request<InternetRadioStatus>('/internet-radio/status'),
  internetRadioPlay: (url?: string) =>
    request<InternetRadioStatus>('/internet-radio/play', { method: 'POST', body: JSON.stringify({ url: url || undefined }) }),
  internetRadioPause: () => request<InternetRadioStatus>('/internet-radio/pause', { method: 'POST' }),
  internetRadioResume: () => request<InternetRadioStatus>('/internet-radio/resume', { method: 'POST' }),
  internetRadioStop: () => request<InternetRadioStatus>('/internet-radio/stop', { method: 'POST' }),
  internetRadioSetVolume: (level: number) =>
    request<InternetRadioStatus>('/internet-radio/volume', { method: 'POST', body: JSON.stringify({ level }) }),
  radioFavorites: () => request<RadioStation[]>('/internet-radio/favorites'),
  radioAddFavorite: (station: RadioStation) =>
    request<RadioStation[]>('/internet-radio/favorites', { method: 'POST', body: JSON.stringify(station) }),
  radioRemoveFavorite: (url: string) =>
    request<RadioStation[]>(`/internet-radio/favorites?url=${encodeURIComponent(url)}`, { method: 'DELETE' }),

  restartBackend: () => request<{ restarting: boolean }>('/system/restart-backend', { method: 'POST' }),

  radioDirectorySearch: (q?: string, country = 'GB') =>
    request<{ stations: RadioStation[]; count: number }>(
      `/radio-directory/search?${new URLSearchParams({ ...(q ? { q } : {}), country })}`,
    ),
  radioDirectoryClick: (uuid: string) => request<{ ok: boolean }>(`/radio-directory/click/${encodeURIComponent(uuid)}`, { method: 'POST' }),
  settings: () =>
    request<{ app_name: string; environment: string; mode: string; plugins: { name: string; status: string }[] }>(
      '/settings',
    ),

  // Generic config sections (data/config.json). Secrets come back blanked
  // with a `<key>_set` boolean; sending an empty secret leaves it unchanged.
  getConfig: (section: string) => request<Record<string, unknown>>(`/config/${section}`),
  setConfig: (section: string, value: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/config/${section}`, { method: 'PUT', body: JSON.stringify({ value }) }),

  // Backup/restore of data/config.json + data/vanos.db as a single zip.
  // Download goes through a plain URL (like the camera snapshot) rather
  // than a fetch+blob dance, so the browser's native "Save file" flow
  // handles it; the token has to go as a query param for the same
  // reason an <img> tag can't send a custom header.
  backupUrl: () => {
    if (isDemo) return null;
    const t = getToken();
    return `${API_BASE}/backup${t ? `?token=${encodeURIComponent(t)}` : ''}`;
  },
  restoreBackup: async (file: File) => {
    if (isDemo) return demoRequest<{ ok: boolean; message: string }>('/backup/restore', { method: 'POST' });
    const form = new FormData();
    form.append('file', file);
    const headers = new Headers();
    const token = getToken();
    if (token) headers.set('X-App-Token', token);
    const res = await fetch(`${API_BASE}/backup/restore`, { method: 'POST', body: form, headers, credentials: 'same-origin' });
    if (!res.ok) {
      let msg = res.statusText;
      try { const j = await res.json(); if (j?.detail) msg = String(j.detail); } catch { /* ignore */ }
      throw new ApiError(res.status, msg);
    }
    return (await res.json()) as { ok: boolean; message: string };
  },
};
