import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Thermometer } from 'lucide-react';
import { useThemeAssets } from '@/lib/useThemeAssets';

import { api } from '@/lib/api';
import { useEnvironment, useWeather } from '@/lib/telemetry';
import { fmtTemp, DASH } from '@/lib/format';
import { DataRow } from './shared';
import { WEATHER_GRAPHICS, pick } from './graphics/registry';
import type { WidgetProps } from './types';

/** PHASE 2 NOTE: this widget still renders Adventure's vm-* classes,
 *  which are defined in adventure.css - a lazy chunk. Placed outside
 *  Adventure today it would be unstyled. See widgets/STYLING.md for the
 *  measured coupling and the route to presentation-independence. */
/** WEATHER / OUTSIDE.
 *
 *  TRUTH: the temperature is a real DS18B20 reading; the tomorrow
 *  radiation ratio is a FORECAST and is labelled relative to today
 *  rather than presented as measurement. */
export function WeatherWidget({ state = 'full', variant }: WidgetProps) {
  const WeatherArt = pick(WEATHER_GRAPHICS, variant);
  const { asset } = useThemeAssets();
  const env = useEnvironment(), weather = useWeather();
  const loc = useQuery({ queryKey: ['location'], queryFn: api.location, retry: false });
  const wp = weather.payload;
  const ratio = wp?.tomorrow_vs_today_radiation_ratio;
  const weatherDescription = wp?.current_weather_description;
  const satCount = loc.data?.satellites;

  return (
    <Link to="/weather" className="vw-card vw-weather-card" data-vw-state={state} data-vw-variant={variant ?? 'standard'}>
      <div className="vw-card-head">
        <div>
          <span className="vw-eyebrow">OUTSIDE</span>
          <h3>Weather</h3>
        </div>
        <WeatherArt condition={weatherDescription} size={42} asset={asset('weather', '') || undefined} />
      </div>
      <div className="vw-weather-main">
        <div>
          <strong>{fmtTemp(env.payload?.external_temp_c)}</strong>
          <span>{weatherDescription ?? 'Environment telemetry'}</span>
        </div>
        <Thermometer size={25} />
      </div>
      <div className="vw-weather-data">
        <DataRow label="Tomorrow radiation" value={ratio == null ? DASH : `${Math.round(ratio * 100)}% of today`} />
        <DataRow label="GPS" value={satCount == null ? DASH : `${satCount} satellites`} />
      </div>
    </Link>
  );
}
