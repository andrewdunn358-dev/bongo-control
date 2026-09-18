import type { ComponentType } from 'react';

/**
 * GRAPHIC SLOTS.
 *
 * A widget owns its DATA; a graphic owns how that data is DRAWN. The
 * widget computes the values, hands them to whichever graphic the
 * theme's variant selected, and keeps everything else - the readings,
 * the labels, the truth line, the disclosures.
 *
 * That split is what makes a variant safe. A graphic receives numbers
 * and draws; it cannot fetch, cannot decide what a reading means, and
 * has no route to inventing telemetry the van does not produce. Adding
 * a variant adds a drawing, never a data path.
 *
 * Props are FIXED PER WIDGET TYPE. A graphic cannot ask for more than
 * its widget was built to supply, so a variant can never widen what a
 * widget reads.
 */

/** BATTERY. soc is null when no shunt is fitted - the graphic must
 *  render that as unknown, never as empty or full. */
export interface BatteryGraphicProps {
  soc: number | null | undefined;
  charging: boolean | undefined;
  size: number;
}

/** SOLAR. `active` is simply whether the array is producing. */
export interface SolarGraphicProps {
  active: boolean;
  size: number;
}

/** WEATHER. A condition string from the forecast, or nothing. */
export interface PowerFlowGraphicProps {
  solarWatts: number | null | undefined;
  loadWatts: number | null | undefined;
  netWatts: number | null | undefined;
}

export interface WeatherGraphicProps {
  condition: string | null | undefined;
  size: number;
}

export type BatteryGraphic = ComponentType<BatteryGraphicProps>;
export type SolarGraphic = ComponentType<SolarGraphicProps>;
export type WeatherGraphic = ComponentType<WeatherGraphicProps>;
