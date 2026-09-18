import { VanOSBattery, VanOSSolar, VanOSWeather } from '@/components/VanOSGraphics';
import type { VariantEnvelope } from '@/layout/variantFit';
import type { BatteryGraphicProps, SolarGraphicProps, WeatherGraphicProps } from './types';
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
};

export const SOLAR_GRAPHICS: Record<string, GraphicEntry<SolarGraphicProps>> = {
  standard: { ...ALWAYS_FITS, component: (p) => <VanOSSolar size={p.size} active={p.active} /> },
};

export const WEATHER_GRAPHICS: Record<string, GraphicEntry<WeatherGraphicProps>> = {
  standard: { ...ALWAYS_FITS, component: (p) => <VanOSWeather condition={p.condition} size={p.size} /> },
};

/** The envelope tables the renderer resolves against, per widget id. */
export const VARIANT_TABLES: Record<string, Record<string, VariantEnvelope>> = {
  battery: BATTERY_GRAPHICS,
  solar: SOLAR_GRAPHICS,
  weather: WEATHER_GRAPHICS,
};

/** Every variant name this build can draw, per widget id - the
 *  allow-list a theme is validated against. */
export const WIDGET_VARIANTS: Record<string, string[]> = Object.fromEntries(
  Object.entries(VARIANT_TABLES).map(([id, table]) => [id, Object.keys(table)]),
);

export function pick<P>(table: Record<string, GraphicEntry<P>>, variant: string | undefined): ComponentType<P> {
  return (variant && table[variant]?.component) || table.standard.component;
}
