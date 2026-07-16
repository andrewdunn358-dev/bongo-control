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
  | "vehicle"
  | "system";

export type TelemetrySource = "simulation" | "system";

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
  soc_pct: number;
  voltage: number;
  charging: boolean;
}

export interface SolarPayload {
  watts: number;
  cloud_cover_pct: number;
  peak_today_watts: number;
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

export interface VehiclePayload {
  ignition_on: boolean;
  odometer_km: number;
  engine_ok: boolean;
}

export interface PowerBudget {
  heater_all_night_possible: boolean;
  estimated_runtime_hours: number;
  estimated_recovery_tomorrow_pct: number;
}

export interface SystemPayload {
  power_budget: PowerBudget;
}

export interface TelemetryState {
  energy?: TelemetryMessage<EnergyPayload>;
  battery?: TelemetryMessage<BatteryPayload>;
  solar?: TelemetryMessage<SolarPayload>;
  environment?: TelemetryMessage<EnvironmentPayload>;
  connectivity?: TelemetryMessage<ConnectivityPayload>;
  vehicle?: TelemetryMessage<VehiclePayload>;
  system?: TelemetryMessage<SystemPayload>;
}
