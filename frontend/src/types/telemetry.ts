// Mirrors backend/app/telemetry/models.py — keep these in sync.
// The frontend only ever depends on `domain` + `payload`. `source` is
// informational only (e.g. for a future "data source" badge in
// Settings) and must never drive UI branching — simulation and real
// hardware should be visually indistinguishable.

export type TelemetryDomain =
  | "energy"
  | "battery"
  | "solar"
  | "environment"
  | "connectivity"
  | "system"
  | "notification"
  | "weather";

export type TelemetrySource = "simulation" | "system" | "victron_mppt";

export interface TelemetryMessage<T = Record<string, unknown>> {
  domain: TelemetryDomain;
  source: TelemetrySource;
  timestamp: number;
  payload: T;
}

export interface EnergyPayload {
  solar_watts: number;
  load_watts: number;
  net_watts: number;
  loads: Record<string, boolean>;
}

export interface BatteryPayload {
  // Null when no SmartShunt is present (an MPPT alone can't measure
  // state of charge, only voltage) — shown as "—" rather than faked.
  soc_pct: number | null;
  voltage: number;
  charging: boolean;
  // Real-hardware only (voltage x current from the MPPT's charging current).
  charging_power_w?: number | null;
}

export interface SolarPayload {
  watts: number;
  peak_today_watts: number;
  // Simulation-only synthetic value — no real cloud sensor exists.
  cloud_cover_pct?: number;
  // Real-hardware only, from the MPPT's own reporting.
  yield_today_wh?: number | null;
  charge_state?: string | null;
  charger_error?: string | null;
}

export interface EnvironmentPayload {
  internal_temp_c: number;
  external_temp_c: number;
  humidity_pct: number;
}

export interface ConnectivityPayload {
  online: boolean;
  signal_strength_pct: number;
  connection_type: string;
}

export interface PowerBudget {
  heater_all_night_possible: boolean | null;
  estimated_runtime_hours: number | null;
  note?: string | null;
}

export interface TomorrowOutlook {
  summary: string;
  radiation_ratio_vs_today?: number | null;
  precipitation_probability_pct?: number | null;
  recommendation: string;
}

export interface SystemPayload {
  power_budget: PowerBudget;
  tomorrow_outlook: TomorrowOutlook;
}

export interface DailyWeather {
  weather_code: number | null;
  weather_description: string;
  temp_max_c: number | null;
  temp_min_c: number | null;
  shortwave_radiation_sum_mj: number | null;
  precipitation_probability_max_pct: number | null;
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
  tomorrow_vs_today_radiation_ratio: number | null;
}

export type NotificationLevel = "success" | "info" | "warning" | "error";

export interface NotificationPayload {
  level: NotificationLevel;
  title: string;
  message: string;
}

export interface TelemetryState {
  energy?: TelemetryMessage<EnergyPayload>;
  battery?: TelemetryMessage<BatteryPayload>;
  solar?: TelemetryMessage<SolarPayload>;
  environment?: TelemetryMessage<EnvironmentPayload>;
  connectivity?: TelemetryMessage<ConnectivityPayload>;
  system?: TelemetryMessage<SystemPayload>;
  weather?: TelemetryMessage<WeatherPayload>;
}
