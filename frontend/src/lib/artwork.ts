/**
 * STATE-DRIVEN ARTWORK.
 *
 * A theme may carry SEVERAL images for a widget and say which one shows
 * when - a different battery at each level, a different sky per forecast
 * condition - or supply a body and a fill that VanOS clips to the real
 * reading. The theme still contains no code: it states the mapping, and
 * this module evaluates it against live telemetry.
 *
 * WHY THIS EXISTS. Before it, a package could name exactly one image per
 * widget, fixed forever. Art drawn as a set (Galloway's 63 images) could
 * not be used as designed: one frame was picked and the rest discarded,
 * which is why a carefully drawn theme looked dead on the van.
 *
 * THE HONESTY RULES, which are the whole point:
 *   - a reading the van does not have resolves to NOTHING, and the
 *     widget falls back to VanOS's own drawing. Artwork never stands in
 *     for a measurement: no state of charge means no battery level art,
 *     not the "empty" frame.
 *   - a fill is clipped to the real value, never animated towards a
 *     guess.
 *   - the ROOF is deliberately absent from this file. There is no
 *     position sensor, so no artwork may vary with a position the van
 *     cannot know. One fixed roof image remains available as a plain
 *     asset, which claims nothing.
 *
 * SHAPE (in theme.json, alongside "assets"):
 *
 *   "artwork": {
 *     "battery": {
 *       "levels": [ { "upTo": 20, "image": "assets/bat-20.png" }, … ],
 *       "charging": "assets/bat-charging.png",
 *       "fill": { "body": "assets/body.png", "fill": "assets/fill.png",
 *                 "bottom": 0.86, "top": 0.14 }
 *     },
 *     "solar":   { "bands": [ { "upTo": 5, "image": "…" }, … ] },
 *     "weather": { "conditions": { "clear": "…", "rain": "…" } }
 *   }
 *
 * `upTo` is an upper bound, in percent for battery and watts for solar;
 * the last entry may omit it to mean "anything above". Conditions use
 * the same words the Weather widget shows, lower-cased.
 */

/** One image, chosen by an upper bound on a live number. */
export interface ArtworkStep {
  /** Inclusive upper bound. Absent = no upper bound (the last step). */
  upTo?: number;
  image: string;
}

/** A body image with a fill clipped to the reading. `bottom` and `top`
 *  are fractions of the image height marking where the fill's empty and
 *  full lines sit, so the artwork's own glass can be any shape. */
export interface ArtworkFill {
  body: string;
  fill: string;
  bottom?: number;
  top?: number;
}

export interface BatteryArtwork {
  levels?: ArtworkStep[];
  charging?: string;
  fill?: ArtworkFill;
}

export interface SolarArtwork {
  bands?: ArtworkStep[];
}

export interface WeatherArtwork {
  conditions?: Record<string, string>;
}

export interface Artwork {
  battery?: BatteryArtwork;
  solar?: SolarArtwork;
  weather?: WeatherArtwork;
}

/** What the renderer should draw. `null` means the theme has nothing to
 *  say for this reading, and VanOS's own drawing is used. */
export type ArtworkChoice =
  | { kind: 'image'; src: string }
  | { kind: 'fill'; body: string; fill: string; fraction: number; bottom: number; top: number }
  | null;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The first step whose upper bound the value has not passed. */
function stepFor(steps: ArtworkStep[] | undefined, value: number): string | null {
  if (!steps?.length) return null;
  for (const step of steps) {
    if (step.upTo == null || value <= step.upTo) return step.image || null;
  }
  return steps[steps.length - 1]?.image || null;
}

/** BATTERY. Charging art wins while charging; otherwise the level set;
 *  a fill pair wins over both, since it is the most precise. */
export function batteryArtwork(
  art: BatteryArtwork | undefined,
  reading: { soc: number | null | undefined; charging: boolean | undefined },
  resolve: (path: string) => string | undefined,
): ArtworkChoice {
  if (!art) return null;
  const soc = reading.soc;
  if (!finite(soc)) return null; // no state of charge: say nothing

  const value = Math.max(0, Math.min(100, soc));

  if (art.fill) {
    const body = resolve(art.fill.body);
    const fill = resolve(art.fill.fill);
    if (body && fill) {
      return {
        kind: 'fill',
        body,
        fill,
        fraction: value / 100,
        bottom: clampFraction(art.fill.bottom, 1),
        top: clampFraction(art.fill.top, 0),
      };
    }
  }

  if (reading.charging && art.charging) {
    const src = resolve(art.charging);
    if (src) return { kind: 'image', src };
  }

  const path = stepFor(art.levels, value);
  const src = path ? resolve(path) : undefined;
  return src ? { kind: 'image', src } : null;
}

/** SOLAR, by output in watts. */
export function solarArtwork(
  art: SolarArtwork | undefined,
  reading: { watts: number | null | undefined },
  resolve: (path: string) => string | undefined,
): ArtworkChoice {
  if (!art || !finite(reading.watts)) return null;
  const path = stepFor(art.bands, Math.max(0, reading.watts));
  const src = path ? resolve(path) : undefined;
  return src ? { kind: 'image', src } : null;
}

/** WEATHER, by the condition word the forecast gives. */
export function weatherArtwork(
  art: WeatherArtwork | undefined,
  reading: { condition: string | null | undefined },
  resolve: (path: string) => string | undefined,
): ArtworkChoice {
  const condition = reading.condition?.trim().toLowerCase();
  if (!art?.conditions || !condition) return null;
  const path = art.conditions[condition];
  const src = path ? resolve(path) : undefined;
  return src ? { kind: 'image', src } : null;
}

function clampFraction(v: number | undefined, fallback: number): number {
  return finite(v) ? Math.max(0, Math.min(1, v)) : fallback;
}

/** Validates and normalises an `artwork` block from a package. Unknown
 *  widgets and malformed entries are dropped rather than throwing: a
 *  theme written for a newer VanOS loses the art it cannot use, not its
 *  whole install. Returns undefined when nothing usable remains. */
export function cleanArtwork(raw: unknown, maxSteps = 12): Artwork | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const source = raw as Record<string, unknown>;
  const out: Artwork = {};

  const steps = (value: unknown): ArtworkStep[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    const list = value
      .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
      .map((s) => ({
        upTo: finite(s.upTo) ? s.upTo : undefined,
        image: typeof s.image === 'string' ? s.image : '',
      }))
      .filter((s) => s.image)
      .slice(0, maxSteps)
      // Ascending, so the first match is the right one however it was written.
      .sort((a, b) => (a.upTo ?? Number.POSITIVE_INFINITY) - (b.upTo ?? Number.POSITIVE_INFINITY));
    return list.length ? list : undefined;
  };

  const battery = source.battery as Record<string, unknown> | undefined;
  if (battery && typeof battery === 'object') {
    const levels = steps(battery.levels);
    const charging = typeof battery.charging === 'string' ? battery.charging : undefined;
    const rawFill = battery.fill as Record<string, unknown> | undefined;
    const fill =
      rawFill && typeof rawFill.body === 'string' && typeof rawFill.fill === 'string'
        ? {
            body: rawFill.body,
            fill: rawFill.fill,
            bottom: finite(rawFill.bottom) ? rawFill.bottom : undefined,
            top: finite(rawFill.top) ? rawFill.top : undefined,
          }
        : undefined;
    if (levels || charging || fill) out.battery = { levels, charging, fill };
  }

  const solar = source.solar as Record<string, unknown> | undefined;
  if (solar && typeof solar === 'object') {
    const bands = steps(solar.bands);
    if (bands) out.solar = { bands };
  }

  const weather = source.weather as Record<string, unknown> | undefined;
  if (weather && typeof weather === 'object' && weather.conditions && typeof weather.conditions === 'object') {
    const conditions: Record<string, string> = {};
    for (const [key, value] of Object.entries(weather.conditions as Record<string, unknown>)) {
      if (typeof value === 'string' && value) conditions[key.trim().toLowerCase()] = value;
    }
    if (Object.keys(conditions).length) out.weather = { conditions };
  }

  return Object.keys(out).length ? out : undefined;
}

/** Every image path an artwork block refers to - what the Pi checks is
 *  present, and what the Studio has to pack. */
export function artworkPaths(art: Artwork | undefined): string[] {
  if (!art) return [];
  const paths: string[] = [];
  for (const step of art.battery?.levels ?? []) paths.push(step.image);
  if (art.battery?.charging) paths.push(art.battery.charging);
  if (art.battery?.fill) paths.push(art.battery.fill.body, art.battery.fill.fill);
  for (const step of art.solar?.bands ?? []) paths.push(step.image);
  for (const path of Object.values(art.weather?.conditions ?? {})) paths.push(path);
  return [...new Set(paths)];
}
