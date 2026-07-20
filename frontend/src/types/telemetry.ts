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
  // Current/power drawn from the MPPT's own LOAD output terminal
  // specifically (e.g. an inverter wired to it) — NOT the van's total
  // consumption if anything else draws power straight from the
  // battery bus rather than through this terminal.
  load_current_a?: number | null;
  load_power_w?: number | null;
}

export interface EnvironmentPayload {
  // All nullable: the 1-Wire plugin sends null when a sensor's role
  // isn't assigned yet, when a reading fails its CRC check, or - for
  // humidity - when the hardware simply can't measure it (a DS18B20 is
  // temperature-only). The simulation always sent real numbers, which
  // is why these were originally typed as non-null and the UI showed
  // "NaN°" the first time real hardware reported a null.
  internal_temp_c: number | null;
  external_temp_c: number | null;
  humidity_pct: number | null;
  // Present from the 1-Wire plugin: every detected probe with its raw
  // reading, including ones with no role assigned yet.
  sensors?: { id: string; temperature_c: number | null; role: string | null }[];
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
