import type { PowerFlowDirection } from './types';

/**
 * Below this many watts either way, the battery is treated as neither
 * charging nor discharging. The net figure is solar in minus visible
 * load out, both of which jitter by a few watts reading to reading; a
 * graphic that flipped its arrows on every wobble around zero would be
 * reporting noise as a change of state.
 */
export const BALANCED_WITHIN_W = 5;

/** Which way energy is flowing through the battery, from the net
 *  balance the van already publishes. Unknown when there is no reading -
 *  never guessed as balanced. */
export function powerFlowDirection(netWatts: number | null | undefined): PowerFlowDirection {
  if (netWatts == null || !Number.isFinite(netWatts)) return 'unknown';
  if (Math.abs(netWatts) < BALANCED_WITHIN_W) return 'balanced';
  return netWatts > 0 ? 'charging' : 'discharging';
}
