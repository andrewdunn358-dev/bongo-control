import type { WidgetState } from '@/components/widgets/types';
import { resolveVariant, STANDARD, type FallbackReason, type VariantTable } from './variantFit';

/**
 * WHICH DRAWING A GRAPHIC WIDGET SHOWS. One rule, decided here and
 * nowhere else:
 *
 *   1. THEME GRAPHIC  the theme named a registered drawing for this
 *                     widget, and it fits the slot.
 *   2. THEME ASSET    the theme packages an image for this widget that is
 *                     declared AND confirmed present (themeAssetResolve.ts).
 *   3. BUILT-IN       VanOS's own drawing - the animated default, or the
 *                     standard one when the default does not fit.
 *
 * WHY HERE. The precedence used to live inside each drawing: the
 * illustrated graphics drew a packaged image instead of themselves when
 * handed one, and the standard drawing ignored packaged images
 * entirely. So whether a theme's battery image appeared at all depended
 * on which variant it had happened to pick. It also meant a guessed
 * image path could switch every animated graphic off (#52). The
 * renderer is the one place that knows the theme's choice, the slot's
 * measured size and whether an image really exists, so it decides.
 *
 * A theme that names "standard" has chosen the plain drawing, and gets
 * it - an explicit choice, not the absence of one.
 */

/**
 * `variant` is always set, and is always the CARD's presentation - a
 * variant restyles the whole card (border, background, the space the
 * drawing gets), not just the drawing. For a packaged image it is the
 * built-in drawing the image is standing in for, so the image sits in
 * the card that drawing would have had, not in one sized for another.
 */
export type GraphicChoice =
  | { source: 'theme-graphic'; variant: string; reason: FallbackReason }
  | { source: 'theme-asset'; url: string; variant: string; reason: FallbackReason }
  | { source: 'built-in'; variant: string; reason: FallbackReason };

export interface GraphicChoiceInput {
  /** The drawing the theme named for this widget, already validated
   *  against the registry. Undefined when it named none. */
  themeVariant?: string;
  /** A packaged image URL - only ever one that is declared AND
   *  confirmed present. Undefined otherwise. */
  asset?: string;
  /** The widget's own default drawing. */
  defaultVariant?: string;
  table: VariantTable;
  state: WidgetState;
  box: { width: number; height: number } | null;
}

export function chooseGraphic(input: GraphicChoiceInput): GraphicChoice {
  const { themeVariant, asset, defaultVariant, table, state, box } = input;

  if (themeVariant) {
    if (themeVariant === STANDARD) {
      return { source: 'theme-graphic', variant: STANDARD, reason: 'requested' };
    }
    const d = resolveVariant(themeVariant, table, state, box);
    if (d.reason === 'requested') return { source: 'theme-graphic', variant: d.variant, reason: d.reason };
    // Not measured yet: the slot's size is unknown for one frame. Keep to
    // the theme's own route rather than flashing its packaged image first
    // and then swapping it away.
    if (d.reason === 'not-measured-yet') return { source: 'theme-graphic', variant: STANDARD, reason: d.reason };
    // Otherwise the theme's drawing cannot be used here - too small, or a
    // state it does not draw - so fall through to the next source.
  }

  const d = resolveVariant(defaultVariant, table, state, box);
  if (asset) return { source: 'theme-asset', url: asset, variant: d.variant, reason: d.reason };
  return { source: 'built-in', variant: d.variant, reason: d.reason };
}
