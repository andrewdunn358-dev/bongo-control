// Domain payload types — mirrors §2.2 of the backend spec exactly.
// Any nullable field HERE reflects a real hardware limitation and MUST NOT
// be silently defaulted to a number in the UI.

export type TelemetryDomain =
  | 'energy'
  | 'battery'
  | 'solar'
  | 'environment'
  | 'connectivity'
  | 'system'
  | 'notification'
  | 'weather';

export type TelemetrySource =
  | 'simulation'
  | 'system'
  | 'victron_mppt'
  | 'weather'
  | 'onewire_temp'
  | string;

export interface TelemetryMessage<T = unknown> {
  domain: TelemetryDomain;
  source: TelemetrySource;
  timestamp: number; // unix seconds
  payload: T;
}

export interface BatteryPayload {
  /** ALWAYS null on this van — no shunt fitted. Never display a %. */
  soc_pct: number | null;
  voltage: number;
  charging: boolean;
  charging_power_w?: number | null;
}

export interface SolarPayload {
  watts: number;
  peak_today_watts: number;
  yield_today_wh?: number | null;
  /** "bulk" | "absorption" | "float" | "off" */
  charge_state?: string | null;
  charger_error?: string | null;
  /** MPPT LOAD terminal only — NOT total van draw. */
  load_current_a?: number | null;
  load_power_w?: number | null;
}

export interface EnergyPayload {
  solar_watts: number;
  load_watts: number;
  net_watts: number;
  /** Empty {} on real hardware — no circuit sensing exists. */
  loads: Record<string, boolean>;
}

export interface EnvironmentSensor {
  id: string;
  temperature_c: number | null;
  role: string | null;
}

export interface EnvironmentPayload {
  internal_temp_c: number | null;
  external_temp_c: number | null;
  /** Always null — DS18B20 is temperature-only. */
  humidity_pct: number | null;
  sensors?: EnvironmentSensor[];
}

export interface DailyWeather {
  date?: string | null;
  weather_code: number | null;
  weather_description: string;
  temp_max_c: number | null;
  temp_min_c: number | null;
  shortwave_radiation_sum_mj: number | null;
  precipitation_probability_max_pct: number | null;
  /** Local time, no timezone suffix. Slice — do not parse with Date(). */
  sunrise: string | null;
  sunset: string | null;
}

export interface WeatherPayload {
  current_temp_c: number | null;
  current_cloud_cover_pct: number | null;
  current_weather_code: number | null;
  current_weather_description: string;
  today: DailyWeather;
  tomorrow: DailyWeather;
  forecast?: DailyWeather[];
  tomorrow_vs_today_radiation_ratio: number | null;
}

export interface ConnectivityPayload {
  online: boolean;
  ssid?: string | null;
  ip?: string | null;
  signal_dbm?: number | null;
}

export interface SystemPayload {
  cpu_pct?: number | null;
  ram_pct?: number | null;
  temperature_c?: number | null;
  uptime_s?: number | null;
  version?: string | null;
}

/* -------- REST payloads -------- */

export interface MissionBriefPrediction {
  key: string;
  label: string;
  value: number | null;
  unit: string | null;
  confidence: string | null;
}

export interface MissionBriefSignal {
  source: string;
  severity: string;
  message: string;
  weight: number;
}

export interface MissionBrief {
  status: 'green' | 'amber' | 'red';
  summary: string;
  recommendations: string[];
  predictions: MissionBriefPrediction[];
  signals: MissionBriefSignal[];
  computed_at: number;
}

/**
 * Matches the real backend exactly (see backend/app/services/poi_service.py
 * `_build_poi_dict`). The original rebuild assumed lat/lng, `items`,
 * `cached`, and a `distance_m` the backend never sends, which would
 * have rendered Nearby empty.
 */
export interface PoiItem {
  id: number;
  category: string;
  name: string | null;
  latitude: number;
  longitude: number;
  opening_hours: string | null;
  fee: string | null;
  // Present only where OpenStreetMap actually has them - many
  // campsites and dump stations are mapped with just a location and a
  // name, so these are frequently null and must not be assumed.
  address: string | null;
  phone: string | null;
  website: string | null;
}

export interface PoiResponse {
  results: PoiItem[];
  from_cache: boolean;
  /** Unix seconds (a float), not an ISO string. */
  cached_at: number | null;
}

/**
 * Matches backend/app/services/ai_recommendations_service.py exactly.
 *
 * These are NOT POI objects. The model suggests named places from its
 * own knowledge (grounded with nearby OSM names, but not limited to
 * them), so there are no coordinates and no distance - it may well
 * name a castle that isn't in our POI cache at all.
 */
export interface AiRecommendation {
  name: string;
  description: string;
  category: string;
}

export interface AiRecommendationsResponse {
  place_name: string | null;
  recommendations: AiRecommendation[];
  from_cache: boolean;
  /** Unix seconds (float), not an ISO string. */
  cached_at: number | null;
}

/** Matches backend/app/services/relay_service.py. */
export interface Relay {
  id: number;
  gpio: number;
  name: string;
  /** What we last told the relay. NOT the physical circuit state -
   *  the relays sit in parallel with manual switches and there is no
   *  sense line back. */
  commanded_on: boolean;
}

export interface RelayResponse {
  available: boolean;
  reason: string | null;
  state_is_commanded_only: boolean;
  channels: Relay[];
}

export interface WifiNetwork {
  ssid: string;
  signal: number; // dBm
  secured: boolean;
  current: boolean;
}

export interface WifiStatus {
  connected: boolean;
  ssid: string | null;
  ip: string | null;
}

/** Matches backend/app/plugins/base.py PluginStatus + Plugin.health(). */
export interface PluginInfo {
  name: string;
  display_name: string;
  version: string;
  status: 'stopped' | 'starting' | 'running' | 'error' | 'disabled';
  /** Unix seconds, or null if the plugin has never reported. */
  last_heartbeat: number | null;
  last_error: string | null;
  enabled: boolean;
  /** Victron only - present when a device has been identified. */
  device_name?: string | null;
  mac_address?: string | null;
}

export interface HistorySample {
  t: number; // unix seconds
  value: number | null;
}

/**
 * The history endpoint returns a bare ARRAY of telemetry messages -
 * the same {domain, source, timestamp, payload} shape the WebSocket
 * pushes - not a pre-flattened {t, value} series. Charts pick whichever
 * payload field they want out of it, which is what allows one endpoint
 * to serve battery voltage, solar watts and temperature without the
 * backend knowing what's being plotted.
 */
export type HistoryResponse = TelemetryMessage[];

export interface HealthResponse {
  ok: boolean;
  version: string;
  plugins: { name: string; status: string }[];
}

export interface AuthStatus {
  required: boolean;
}
