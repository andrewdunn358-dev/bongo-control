import { VanOSBattery, VanOSSolar, VanOSWeather } from '@/components/VanOSGraphics';
import type { BatteryGraphic, SolarGraphic, WeatherGraphic } from './types';

/**
 * WHICH DRAWING EACH VARIANT USES.
 *
 * 'standard' is the drawing VanOS has always used, unchanged. A theme
 * naming a variant that does not exist here resolves to 'standard'
 * rather than failing - a theme built for a newer VanOS loses its
 * bespoke look, not its battery reading.
 */
export const BATTERY_GRAPHICS: Record<string, BatteryGraphic> = {
  standard: (p) => <VanOSBattery soc={p.soc} charging={p.charging} size={p.size} />,
};

export const SOLAR_GRAPHICS: Record<string, SolarGraphic> = {
  standard: (p) => <VanOSSolar size={p.size} active={p.active} />,
};

export const WEATHER_GRAPHICS: Record<string, WeatherGraphic> = {
  standard: (p) => <VanOSWeather condition={p.condition} size={p.size} />,
};

/** Every variant name this build can draw, per widget id. The registry
 *  is the allow-list a theme is validated against. */
export const WIDGET_VARIANTS: Record<string, string[]> = {
  battery: Object.keys(BATTERY_GRAPHICS),
  solar: Object.keys(SOLAR_GRAPHICS),
  weather: Object.keys(WEATHER_GRAPHICS),
};

export function pick<T>(table: Record<string, T>, variant: string | undefined): T {
  return (variant && table[variant]) || table.standard;
}
