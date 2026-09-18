import type { WidgetState } from '@/components/widgets/types';

/**
 * CHOOSING BETWEEN A BESPOKE VARIANT AND THE STANDARD DRAWING.
 *
 * An illustrated variant is worth having only where there is room to
 * draw it. Squeezed into a quarter-width slot on a 628px-tall tablet it
 * is worse than the standard drawing, not better - which is exactly the
 * "desktop design scaled down" failure this exists to prevent.
 *
 * So a variant declares the space it needs and the states it can draw,
 * and the RENDERER decides. The renderer already owns placement and
 * presentation state; which drawing fits in the box it just allocated
 * is the same kind of decision. The widget still owns its data and the
 * graphic still owns its rendering - neither is consulted about the
 * viewport.
 *
 * Falling back is NORMAL, not an error: the theme keeps its colours,
 * its imagery and its composition, and loses one illustration in one
 * slot that was too small for it.
 */

export interface VariantEnvelope {
  /** Smallest slot width this drawing is worth using in, CSS px. */
  minWidth: number;
  /** Smallest slot height, CSS px. */
  minHeight: number;
  /** Presentation states this drawing implements. A variant that has
   *  no compact form simply does not claim one, and the renderer uses
   *  the standard drawing when the layout goes compact. */
  states: WidgetState[];
}

export type VariantTable = Record<string, VariantEnvelope>;

export type FallbackReason =
  | 'requested'
  | 'no-variant-requested'
  | 'unknown-variant'
  | 'state-unsupported'
  | 'too-narrow'
  | 'too-short'
  | 'not-measured-yet';

export interface VariantDecision {
  variant: string;
  reason: FallbackReason;
}

/** The drawing every widget has and every theme falls back to. */
export const STANDARD = 'standard';

/**
 * Pure, so it can be tested without a browser.
 *
 * `box` is the slot the renderer allocated. Null means it has not been
 * measured yet - on the very first paint - and the standard drawing is
 * used until it has been. A bespoke variant appearing one frame late is
 * better than an illustrated one drawn into a box of unknown size.
 */
export function resolveVariant(
  requested: string | undefined,
  table: VariantTable,
  state: WidgetState,
  box: { width: number; height: number } | null,
): VariantDecision {
  if (!requested || requested === STANDARD) return { variant: STANDARD, reason: 'no-variant-requested' };

  const envelope = table[requested];
  if (!envelope) return { variant: STANDARD, reason: 'unknown-variant' };
  if (!envelope.states.includes(state)) return { variant: STANDARD, reason: 'state-unsupported' };
  if (!box) return { variant: STANDARD, reason: 'not-measured-yet' };
  if (box.width < envelope.minWidth) return { variant: STANDARD, reason: 'too-narrow' };
  if (box.height < envelope.minHeight) return { variant: STANDARD, reason: 'too-short' };

  return { variant: requested, reason: 'requested' };
}
