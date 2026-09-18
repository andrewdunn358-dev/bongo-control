import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';

/**
 * Cockpit theme registry.
 *
 * A theme is a WIDE-SCREEN cockpit layout: one component plus its own
 * namespaced stylesheet. Adding one is a single entry here and nothing
 * else - Home.tsx and the Settings picker both read this list, so
 * neither needs touching.
 *
 * WHAT A THEME MAY CHANGE: layout, styling, which real readings it
 * chooses to show and how prominently.
 *
 * WHAT A THEME MAY NOT CHANGE: the data. Themes consume the same
 * telemetry hooks and the same API. They never fetch differently,
 * never transform a reading into something it isn't, and never imply a
 * state the hardware cannot verify - relay state is commanded not
 * measured, roof position is unknown, heater fuel is estimated. A
 * theme is a view, not a source of truth.
 *
 * CSS ISOLATION IS THE THEME AUTHOR'S JOB. Each theme prefixes every
 * class and custom property with its own token (van- / vm- / ...) and
 * imports its own stylesheet from its own component. Nothing is added
 * to index.css. Two themes are never mounted at once, but their CSS
 * both ships in the bundle, so an unprefixed `.card` in one theme
 * would silently restyle the other.
 *
 * Mobile is NOT themed: below the wide-screen breakpoint Home always
 * renders the Instrument cockpit, whatever is selected here. A phone
 * layout has different constraints and is not something themes should
 * fragment. It is the same component the Instrument theme renders, not
 * a second phone copy - keeping one copy is deliberate, because when
 * this layout existed twice the two drifted apart.
 */
export type CockpitThemeId = string;

export interface CockpitTheme {
  id: CockpitThemeId;
  /** Shown in the Settings picker. */
  name: string;
  /** One line under the name - what the theme is for, not how it looks. */
  description: string;
  /** Lazy so only the selected theme's code and CSS are fetched. */
  component: LazyExoticComponent<ComponentType>;
}

export const COCKPIT_THEMES: CockpitTheme[] = [
  {
    id: 'instrument',
    name: 'Instrument',
    description: 'The 3x3 telemetry dashboard - every reading on one grid',
    component: lazy(() =>
      import('@/components/cockpits/InstrumentCockpit').then((m) => ({ default: m.InstrumentCockpit })),
    ),
  },
  {
    id: 'control',
    name: 'VanOS Control',
    description: 'Camera, separate pop-top controls and the four van switches on one cockpit',
    component: lazy(() =>
      import('@/components/cockpits/ControlCockpit').then((m) => ({ default: m.ControlCockpit })),
    ),
  },
  {
    id: 'adventure',
    name: 'Adventure',
    description: 'Camera hero, magazine styling, image action tiles',
    component: lazy(() =>
      import('@/components/cockpits/AdventureCockpit').then((m) => ({ default: m.AdventureCockpit })),
    ),
  },
];

/** The theme used when nothing is stored, or when a stored id no longer
 *  exists (a theme removed in an update must not leave a blank cockpit). */
export const DEFAULT_COCKPIT_THEME: CockpitThemeId = 'instrument';

export function getCockpitTheme(id: CockpitThemeId | null | undefined): CockpitTheme {
  return (
    COCKPIT_THEMES.find((t) => t.id === id) ??
    COCKPIT_THEMES.find((t) => t.id === DEFAULT_COCKPIT_THEME) ??
    COCKPIT_THEMES[0]
  );
}
