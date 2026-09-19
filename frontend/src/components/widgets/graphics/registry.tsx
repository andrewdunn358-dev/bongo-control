import { VanOSBattery, VanOSSolar, VanOSWeather } from '@/components/VanOSGraphics';
import { IllustratedBattery, IllustratedSolar, IllustratedWeather, IllustratedPowerFlow } from './illustrated';
import type { VariantEnvelope } from '@/layout/variantFit';
import type { BatteryGraphicProps, SolarGraphicProps, WeatherGraphicProps, PowerFlowGraphicProps } from './types';
import type { ComponentType } from 'react';

/**
 * WHICH DRAWING EACH VARIANT USES, and the space it needs.
 *
 * 'standard' is the drawing VanOS has always used. Its envelope is zero
 * because it is the fallback - there must always be something that
 * fits, whatever the slot turns out to be.
 *
 * A bespoke variant declares real minimums and the states it can draw.
 * The renderer compares them against the slot it allocated and uses the
 * standard drawing when they cannot be met, so an illustrated graphic
 * is never squeezed into a box too small to read it in.
 */
export interface GraphicEntry<P> extends VariantEnvelope {
  component: ComponentType<P>;
}

const ALWAYS_FITS: VariantEnvelope = {
  minWidth: 0,
  minHeight: 0,
  states: ['full', 'compact', 'minimal'],
};

export const BATTERY_GRAPHICS: Record<string, GraphicEntry<BatteryGraphicProps>> = {
  standard: { ...ALWAYS_FITS, component: (p) => <VanOSBattery soc={p.soc} charging={p.charging} size={p.size} /> },
  illustrated: { minWidth: 170, minHeight: 110, states: ['full', 'compact'], component: IllustratedBattery },
};

export const SOLAR_GRAPHICS: Record<string, GraphicEntry<SolarGraphicProps>> = {
  standard: { ...ALWAYS_FITS, component: (p) => <VanOSSolar size={p.size} active={p.active} /> },
  illustrated: { minWidth: 150, minHeight: 100, states: ['full', 'compact'], component: IllustratedSolar },
};

export const WEATHER_GRAPHICS: Record<string, GraphicEntry<WeatherGraphicProps>> = {
  standard: { ...ALWAYS_FITS, component: (p) => <VanOSWeather condition={p.condition} size={p.size} /> },
  illustrated: { minWidth: 90, minHeight: 70, states: ['full', 'compact'], component: IllustratedWeather },
};

export const POWER_FLOW_GRAPHICS: Record<string, GraphicEntry<PowerFlowGraphicProps>> = {
  standard: { ...ALWAYS_FITS, component: () => null },
  illustrated: { minWidth: 240, minHeight: 90, states: ['full', 'compact'], component: IllustratedPowerFlow },
};

/** Generic presentation envelopes for widgets that render their own visual
 *  surface (rather than delegating to a graphic component). */
export const PRESENTATION_TABLES: Record<string, Record<string, VariantEnvelope>> = {
  'action-heater': {
    standard: ALWAYS_FITS,
    illustrated: { minWidth: 120, minHeight: 58, states: ['full', 'compact'] },
  },
  'action-roof': {
    standard: ALWAYS_FITS,
    illustrated: { minWidth: 120, minHeight: 58, states: ['full', 'compact'] },
  },
  'action-switches': {
    standard: ALWAYS_FITS,
    illustrated: { minWidth: 120, minHeight: 58, states: ['full', 'compact'] },
  },
};

/**
 * THE DRAWING A GRAPHIC WIDGET USES WHEN THE THEME CHOOSES NONE.
 *
 * The animated illustrations, for every theme - including the
 * built-in ones and a colours-only package. Still subject to the same
 * size envelope as any other variant, so a slot too small for one gets
 * the standard drawing rather than a squeezed one.
 *
 * A theme that wants the plain drawing names "standard" explicitly.
 */
export const DEFAULT_VARIANTS: Record<string, string> = {
  battery: 'illustrated',
  solar: 'illustrated',
  weather: 'illustrated',
  'power-flow': 'illustrated',
};

/** Widgets whose drawing is a GRAPHIC - chosen by the precedence in
 *  layout/graphicChoice.ts, and replaceable by a packaged image. The
 *  asset role for each is its widget id. Action tiles are not here: they
 *  are presentation styles, and their packaged photos are backgrounds. */
export const GRAPHIC_WIDGETS = new Set(Object.keys(DEFAULT_VARIANTS));

/** The envelope tables the renderer resolves against, per widget id. */
export const VARIANT_TABLES: Record<string, Record<string, VariantEnvelope>> = {
  battery: BATTERY_GRAPHICS,
  solar: SOLAR_GRAPHICS,
  weather: WEATHER_GRAPHICS,
  'power-flow': POWER_FLOW_GRAPHICS,
  ...PRESENTATION_TABLES,
};

/** Every variant name this build can draw, per widget id - the
 *  allow-list a theme is validated against. */
export const WIDGET_VARIANTS: Record<string, string[]> = Object.fromEntries(
  Object.entries(VARIANT_TABLES).map(([id, table]) => [id, Object.keys(table)]),
);

export function pick<P>(table: Record<string, GraphicEntry<P>>, variant: string | undefined): ComponentType<P> {
  return (variant && table[variant]?.component) || table.standard.component;
}
