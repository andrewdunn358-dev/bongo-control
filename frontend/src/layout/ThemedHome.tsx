import { useAutoFit } from '@/lib/useAutoFit';
import { useLayoutMode } from '@/lib/useLayoutMode';
import { useCockpitTheme } from '@/lib/useCockpitTheme';
import { LayoutRenderer } from './LayoutRenderer';
import { builtinComposition } from './builtins';
import type { LayoutDefinition } from './schema';

/**
 * THE SINGLE THEMED HOME PATH.
 *
 * Everything a composition needs in order to be drawn, and nothing that
 * belongs to any particular appearance:
 *
 *   - the measured SURFACE, whose --fit and ladder step the grid and the
 *     widgets respond to;
 *   - the PRESENTATION STATE for the available surface;
 *   - the COMPOSITION, from the selected theme or from the built-in it
 *     names;
 *   - the per-widget DRAWING the theme asked for.
 *
 * This replaces AdventureCockpit. That component did exactly these four
 * things and nothing else, so keeping it would have left one appearance
 * with a privileged React path while every other appearance had to come
 * through data. Adventure is now a composition like any other.
 */
export function ThemedHome({ composition }: { composition: LayoutDefinition }) {
  // Fitted in EVERY mode, portrait included. Disabling it in portrait
  // was tried and reverted: on the face of it there is nothing to fit
  // there, because the page scrolls and the ladder was taking Adventure
  // to its 0.78 floor and shedding two rungs on a phone with room below
  // the fold. But measured, the ladder turned out to be carrying the
  // narrow column too - unfitted at 363px the 56px headline collides
  // with the quote and the footer runs off the side. The widgets' own
  // container queries are what should be handling that width, and until
  // they do, --fit is the only thing holding portrait together.
  // See tablet-panel-milestone: this is width work, not fit work.
  const fitRef = useAutoFit<HTMLDivElement>();
  const mode = useLayoutMode();
  const { widgetPresentation } = useCockpitTheme();
  // The renderer decides the state; widgets are told, and never inspect
  // the layout mode themselves.
  const state = mode === 'landscape' ? 'compact' : 'full';
  return (
    <div className="vl-surface" ref={fitRef}>
      <LayoutRenderer layout={composition} state={state} presentation={widgetPresentation} />
    </div>
  );
}

/**
 * Which composition a selected theme resolves to, or undefined when the
 * theme names a cockpit this build still renders as a hand-written
 * component.
 *
 * A theme's own composition wins. A theme without one inherits the
 * composition of the built-in it names, which is what lets a
 * colours-and-imagery-only package work unchanged.
 */
export function resolveComposition(
  cockpitId: string,
  themeLayout: LayoutDefinition | undefined,
): LayoutDefinition | undefined {
  return themeLayout ?? builtinComposition(cockpitId);
}
