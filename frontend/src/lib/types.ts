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
  /**
   * Null until a SmartShunt has SYNCHRONISED — which is not the same as
   * "no shunt". A shunt reports current immediately but cannot know a
   * percentage until it has observed one full charge with the battery
   * capacity configured, possibly days after fitting. Was previously
   * documented as "ALWAYS null on this van", which stopped being true
   * the moment one was installed.
   */
  soc_pct: number | null;
  voltage: number;
  charging: boolean;
  charging_power_w?: number | null;
  /**
   * Shunt-only fields. Their presence is how the UI tells a fitted
   * shunt from no shunt: nothing else in this system measures current
   * at the battery. Positive is INTO the battery, negative is out.
   */
  current_a?: number | null;
  power_w?: number | null;
  consumed_ah?: number | null;
  time_remaining_mins?: number | null;
  /**
   * The shunt's AUX input, wired to the external leisure battery.
   * Voltage only - the aux input cannot measure current, so there is no
   * state of charge for that battery. Victron labels this "starter
   * battery" in its own app; that is not what it is here.
   */
  external_voltage?: number | null;
  /**
   * True when `soc_pct` above was recalculated by the app rather than
   * taken from the shunt. The shunt divides by the capacity configured
   * in VictronConnect, which is a single fixed number, so its
   * percentage is wrong whenever the external battery is paralleled
   * on. `consumed_ah` is a raw integration of current and does not
   * depend on that setting, so the app can divide by the capacity
   * genuinely connected. See backend battery_bank_service.py.
   */
  soc_is_derived?: boolean | null;
  /** Why the percentage above is what it is - which bank was used. */
  soc_note?: string | null;
  /** Amp-hours currently connected: leisure alone, or both paralleled. */
  bank_amp_hours?: number | null;
  external_connected?: boolean | null;
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

export interface RadioStation {
  uuid: string | null;
  name: string;
  url: string;
  favicon: string | null;
  tags: string[];
  bitrate: number | null;
  codec: string | null;
}

export interface InternetRadioStatus {
  available: boolean;
  running: boolean;
  playing: boolean;
  stream_url: string | null;
  configured_stream_url: string;
  volume: number;
}

export interface MissionBriefPrediction {
  key: string;
  label: string;
  value: number | string | null;
  unit: string | null;
  confidence: string | null;
}

export interface MissionBriefSignal {
  source: string;
  severity: string;
  message: string;
  weight: number;
  /** Optional structured extras. solar_verdict carries the verdict +
   *  figures; solar_history carries harvest summary numbers. */
  detail?: {
    verdict?: 'good' | 'normal' | 'low';
    [key: string]: number | string | null | undefined;
  } | null;
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
 * Predicted mobile coverage — Ofcom Connected Nations Mobile API, via
 * backend/app/services/coverage_service.py.
 *
 * Ofcom's scale is 0 = none, 3 = limited, 4 = likely (1 and 2 are
 * retired). `value` is the most common rating across the addresses in
 * that postcode; `varies` says the addresses disagreed, which is common
 * for a rural postcode covering a long lane.
 */
export interface CoverageRating {
  value: number | null;
  label: 'none' | 'limited' | 'likely' | 'unknown' | null;
  varies: boolean;
  best: number | null;
  worst: number | null;
  /** True when the rating drops once 4G is excluded — i.e. 4G is what's
   *  actually carrying it here. Derived from Ofcom's "No4g" twin fields. */
  relies_on_4g: boolean;
  without_4g: number | null;
}

export interface CoverageOperator {
  /** Ofcom's own prefix: EE, H3 (Three), TF (O2), VO (Vodafone). */
  key: string;
  name: string;
  data_outdoor: CoverageRating;
  data_indoor: CoverageRating;
  voice_outdoor: CoverageRating;
  voice_indoor: CoverageRating;
}

export interface CoveragePlace {
  label: string;
  postcode: string;
  latitude: number | null;
  longitude: number | null;
  /** Metres from the searched point to the postcode Ofcom answered for.
   *  Only present for coordinate lookups, and worth showing when it's
   *  large — a moorland pin can borrow a postcode a mile away. */
  postcode_distance_m?: number | null;
  source: string;
}

export interface CoverageResult {
  postcode: string;
  address_count: number;
  operators: CoverageOperator[];
  place?: CoveragePlace;
  from_cache: boolean;
  cached_at: number | null;
  /** Served from cache because the live fetch failed or no key is set —
   *  not just "cache still fresh". Shown differently in the UI. */
  stale?: boolean;
}

export interface CoverageStatus {
  configured: boolean;
  home_network: string;
  operators: { key: string; name: string }[];
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

/** Matches backend/app/services/voice_control_service.py's status(). */
export interface VoiceControlStatus {
  enabled: boolean;
  configured: boolean;
  listening: boolean;
  processing: boolean;
  mic_device: string;
  playback_device: string;
  wake_word: string;
  last_wake_at: number | null;
  last_command_text: string | null;
  last_reply_text: string | null;
  last_error: string | null;
  voice_controllable_relays: string[];
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
  /** Whether this channel actually switches a circuit that exists.
   *  False = wired to nothing (a spare). It stays togglable here for
   *  bench testing, but Ron won't offer it and voice won't match it,
   *  because clicking a relay with no load behind it and reporting
   *  success would be the same empty confidence this app avoids
   *  everywhere else. */
  in_use: boolean;
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
  /** SSIDs with a saved NetworkManager profile - these auto-reconnect
   * without a password whenever back in range. */
  known_networks: string[];
}

/** A snapshot saved on the Pi. `at` is Unix seconds (a float), not ISO. */
export interface CameraSnapshot {
  id: string;
  at: number;
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
  status: string;
  app_name: string;
  environment: string;
  mode: string;
  uptime_seconds: number;
  plugins: { name: string; status: string }[];
}

export interface AuthStatus {
  required: boolean;
  /** Present on the hardened backend: whether a password is actually set,
   *  and whether production is failing closed for lack of one. */
  configured?: boolean;
  insecure_blocked?: boolean;
}


/** Matches backend/app/services/roof_service.py status(). */
export interface RoofStatus {
  configured: boolean;
  enabled: boolean;
  up_channel: number | null;
  down_channel: number | null;
  /** Relays that break the OEM switch's dynamic-brake bridge while the
   *  app is actively driving, then reconnect it - one per signal wire.
   *  Empty if none configured yet, in which case the switch should be
   *  kept unplugged while driving from the app. */
  isolate_channels: number[];
  /** Which direction is currently commanded, or null if stopped. */
  moving: 'up' | 'down' | null;
  elapsed_seconds: number;
  max_run_seconds: number;
  last_stopped_reason: string | null;
  /** Always true - there is no position sensor and no feedback from
   *  the AFT control unit. The app knows what it commanded, never
   *  where the roof actually is. */
  position_is_unknown: boolean;
}

/** A named, journaled stop — matches backend/app/services/place_service.py. */
export interface Place {
  id: number;
  name: string;
  notes: string | null;
  latitude: number;
  longitude: number;
  arrived_at: number;
  departed_at: number | null;
  created_at: number;
}

/** A detected-but-not-yet-named stop candidate, from GET /places/detected. */
export interface PlaceCandidate {
  latitude: number;
  longitude: number;
  arrived_at: number;
  departed_at: number;
  point_count: number;
}

/** One satellite currently known to the GPS receiver, from a real NMEA
 *  GSV sentence — matches backend/app/plugins/gps_serial/plugin.py.
 *  elevation/azimuth/snr are null when the receiver knows a satellite
 *  is in view (from its almanac) but hasn't reported its position or
 *  signal yet — a real, honest "not tracking" state, not missing data. */
export interface GpsSatellite {
  prn: number;
  constellation: string;
  elevation: number | null;
  azimuth: number | null;
  snr: number | null;
  quality: 'strong' | 'good' | 'fair' | 'poor' | 'not tracking';
}

/** One entry in the persistent relay/roof audit trail — matches
 *  backend/app/db/models.py's RelayEvent and GET /api/relays/events.
 *  channel_id is null for roof-level summary events (a full hold/
 *  release sequence), as opposed to the individual relay-channel
 *  events underneath it. */
export interface RelayEvent {
  id: number;
  timestamp: number;
  channel_id: number | null;
  channel_name: string;
  action: string;
  detail: string | null;
  source: string;
}
