/**
 * DERIVED BATTERY VALUES - worked out in the app from telemetry the van
 * already reports. Nothing here is measured, and nothing here changes
 * the telemetry model: it only reads a BatteryPayload.
 *
 * TIME TO FULL is an ESTIMATE, not a promise. It assumes the current
 * flowing into the battery right now stays the same until it is full.
 * Real charging slows down near the top (absorption), and loads come and
 * go, so the true time is usually LONGER than this says - never read it
 * as a guaranteed finish time.
 *
 * Where the numbers come from:
 *   - state of charge: `soc_pct`. Only exists with a SmartShunt, and only
 *     once it has synchronised.
 *   - capacity: `bank_amp_hours`, published by the backend's battery bank
 *     service from the battery_bank settings (leisure alone, or leisure +
 *     external when it is paralleled on). The same basis the backend uses
 *     for its own state-of-charge correction.
 *   - charge rate: `current_a`, the NET current into the battery measured
 *     by the shunt. Net matters: it is what is actually going into the
 *     battery after the van's own loads. The MPPT's charging_power_w is
 *     not used - it is what the controller puts out, not what the
 *     battery receives, so it would make the estimate too short.
 *
 * It is null - unknown - whenever any of those is missing or doesn't add
 * up. It never falls back to a guess.
 */
import type { BatteryPayload } from './types';

/** Below this the battery is resting, not charging. Same threshold the
 *  Battery widget uses for its RESTING state, so the two never disagree. */
export const RESTING_CURRENT_A = 0.2;

export type TimeToFullReason =
  | 'estimated'
  | 'full'
  | 'no-data'
  | 'not-charging'
  | 'no-soc'
  | 'no-capacity'
  | 'no-charge-current'
  | 'soc-capacity-mismatch';

export interface TimeToFullEstimate {
  /** Whole minutes, 0 when already full; null when it can't be worked out. */
  minutes: number | null;
  /** Why - so a caller can tell "unknown" apart from "full". */
  reason: TimeToFullReason;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function estimateTimeToFull(p: BatteryPayload | null | undefined): TimeToFullEstimate {
  if (!p) return { minutes: null, reason: 'no-data' };

  // Only while charging. A figure while discharging would be meaningless.
  if (p.charging !== true) return { minutes: null, reason: 'not-charging' };

  const soc = p.soc_pct;
  if (!finite(soc) || soc < 0) return { minutes: null, reason: 'no-soc' };

  // Full is a fact, not an estimate: nothing further to calculate.
  if (soc >= 100) return { minutes: 0, reason: 'full' };

  const capacityAh = p.bank_amp_hours;
  if (!finite(capacityAh) || capacityAh <= 0) return { minutes: null, reason: 'no-capacity' };

  // The percentage and the capacity have to describe the same bank. With
  // the external battery paralleled on, capacity is the combined bank,
  // but the shunt's own percentage is still relative to the capacity set
  // in VictronConnect (see backend battery_bank_service.py). Only the
  // app's recalculated percentage matches the combined bank. Mixing the
  // two would give a confidently wrong time, so it is unknown instead.
  if (p.external_connected === true && p.soc_is_derived !== true) {
    return { minutes: null, reason: 'soc-capacity-mismatch' };
  }

  // current_a is a shunt-only field, so its presence is itself the shunt
  // check; no current means no shunt, and no estimate.
  const amps = p.current_a;
  if (!finite(amps) || amps <= RESTING_CURRENT_A) {
    return { minutes: null, reason: 'no-charge-current' };
  }

  const ahToFull = ((100 - soc) / 100) * capacityAh;
  return { minutes: Math.round((ahToFull / amps) * 60), reason: 'estimated' };
}

/** Just the number: minutes to full, 0 if full, null if unknown. */
export function timeToFullMins(p: BatteryPayload | null | undefined): number | null {
  return estimateTimeToFull(p).minutes;
}
