import type { WeatherPayload } from '@/lib/types';

/**
 * Which of the 5 hero photos to show, based on real weather + time of
 * day - not a random rotation, an actual reflection of current
 * conditions. Reuses the same WMO weather-code bands already
 * established in Weather.tsx/format.ts (wmoLabel/iconFor) rather than
 * inventing a second categorisation.
 */
export type HeroImage = 'coast_sunset' | 'desert_dusk' | 'forest_dawn' | 'lake_night' | 'snow_night';

/** Same extraction approach as fmtLocalTime in lib/format.ts - find the
 *  'T' separator dynamically rather than assume a fixed position. */
function hhmm(s: string | null | undefined): string | null {
  if (!s || typeof s !== 'string') return null;
  const idx = s.indexOf('T');
  if (idx === -1) return null;
  return s.slice(idx + 1, idx + 6);
}

function isNight(nowHHMM: string, sunrise: string | null, sunset: string | null): boolean {
  const sr = hhmm(sunrise);
  const ss = hhmm(sunset);
  if (!sr || !ss) return true; // no data - default to the night image, the safe/moody choice
  return nowHHMM < sr || nowHHMM > ss;
}

export function selectHeroImage(weather: WeatherPayload | null | undefined, now: Date = new Date()): HeroImage {
  const code = weather?.current_weather_code;
  const nowHHMM = now.toTimeString().slice(0, 5);
  const night = isNight(nowHHMM, weather?.today?.sunrise ?? null, weather?.today?.sunset ?? null);

  if (code == null) return 'lake_night';
  if (code >= 71 && code <= 77) return 'snow_night'; // snow - only one image, covers day and night
  if ((code >= 45 && code <= 48) || (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) {
    return 'forest_dawn'; // fog, rain, showers, thunder
  }
  if (code === 3) return night ? 'lake_night' : 'desert_dusk'; // overcast
  // Clear or partly cloudy (0, 1, 2)
  return night ? 'lake_night' : 'coast_sunset';
}
