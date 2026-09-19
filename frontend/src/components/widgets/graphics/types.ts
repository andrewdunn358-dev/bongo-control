import type { ComponentType } from 'react';

/**
 * GRAPHIC SLOTS.
 *
 * A widget owns its DATA; a graphic owns how that data is DRAWN. The
 * widget computes the values, hands them to whichever graphic was
 * chosen, and keeps everything else - the readings, the labels, the
 * truth line, the disclosures.
 *
 * That split is what makes a graphic safe. It receives numbers and
 * draws; it cannot fetch, cannot decide what a reading means, and has no
 * route to inventing telemetry the van does not produce. Adding a
 * graphic adds a drawing, never a data path.
 *
 * Props are FIXED PER WIDGET TYPE and carry everything the van actually
 * measures for that widget, so a new graphic - a themed battery, an
 * animated power flow - can be as rich as the data allows without
 * touching the widget. Every field that can be missing is typed as
 * missing: a graphic must draw "unknown" as unknown, never as zero,
 * empty or full.
 *
 * What is deliberately NOT here, because nothing measures it: battery
 * temperature, and solar panel voltage.
 *
 * A graphic never receives a packaged image. Whether a theme's image
 * replaces the drawing is decided once, in layout/graphicChoice.ts, and
 * a graphic that is being drawn at all is always drawn in full.
 */

/** BATTERY. */
export interface BatteryGraphicProps {
  /** State of charge, 0-100. Null until a SmartShunt has synchronised,
   *  and always null without one. */
  soc: number | null | undefined;
  charging: boolean | undefined;
  size: number;
  /** Battery voltage, when reported. */
  voltage?: number | null;
  /** True only when a SmartShunt is fitted, per hasShunt() - never
   *  inferred from current alone. The four fields below are null
   *  whenever it is false. */
  shuntFitted?: boolean;
  /** Amps; positive is INTO the battery, negative is out. Shunt only. */
  currentA?: number | null;
  /** Watts at the battery. Shunt only. */
  powerW?: number | null;
  /** The shunt's estimate of time to empty, in minutes. Shunt only. */
  timeRemainingMins?: number | null;
  /** ESTIMATED minutes to full at the current charge rate (see
   *  lib/batteryDerive.ts): 0 when full, null whenever it can't honestly
   *  be worked out - not charging, no state of charge, no capacity, no
   *  measured charge current. Show null as unknown, never as a number. */
  timeToFullMins?: number | null;
}

/** SOLAR. */
export interface SolarGraphicProps {
  /** Whether the array is producing at all. */
  active: boolean;
  size: number;
  /** MPPT output in watts. */
  watts?: number | null;
  /** The charger's own stage: "bulk" | "absorption" | "float" | "off". */
  chargeState?: string | null;
}

/** Which way energy is going through the battery, derived from the net
 *  balance. See powerFlowDirection() in derive.ts. */
export type PowerFlowDirection = 'charging' | 'discharging' | 'balanced' | 'unknown';

/** POWER FLOW. */
export interface PowerFlowGraphicProps {
  solarWatts: number | null | undefined;
  /** What the loads the van can see are drawing - NOT total van draw,
   *  which is not measurable without a shunt. */
  loadWatts: number | null | undefined;
  netWatts: number | null | undefined;
  direction?: PowerFlowDirection;
}

/** WEATHER. */
export interface WeatherGraphicProps {
  /** A condition string from the forecast, or nothing. */
  condition: string | null | undefined;
  size: number;
  /** Outside temperature from the van's own sensor, when reported. */
  tempC?: number | null;
}

export type BatteryGraphic = ComponentType<BatteryGraphicProps>;
export type SolarGraphic = ComponentType<SolarGraphicProps>;
export type WeatherGraphic = ComponentType<WeatherGraphicProps>;
export type PowerFlowGraphic = ComponentType<PowerFlowGraphicProps>;
