import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Thermometer } from 'lucide-react';
import { VanOSWeather } from '@/components/VanOSGraphics';
import { api } from '@/lib/api';
import { useEnvironment, useWeather } from '@/lib/telemetry';
import { fmtTemp, DASH } from '@/lib/format';
import { DataRow } from './shared';

/** WEATHER / OUTSIDE.
 *
 *  TRUTH: the temperature is a real DS18B20 reading; the tomorrow
 *  radiation ratio is a FORECAST and is labelled relative to today
 *  rather than presented as measurement. */
export function WeatherWidget() {
  const env = useEnvironment(), weather = useWeather();
  const loc = useQuery({ queryKey: ['location'], queryFn: api.location, retry: false });
  const wp = weather.payload;
  const ratio = wp?.tomorrow_vs_today_radiation_ratio;
  const weatherDescription = wp?.current_weather_description;
  const satCount = loc.data?.satellites;

  return (
    <Link to="/weather" className="vm-card vm-weather-card">
      <div className="vm-card-head">
        <div>
          <span className="vm-eyebrow">OUTSIDE</span>
          <h3>Weather</h3>
        </div>
        <VanOSWeather condition={weatherDescription} size={42} />
      </div>
      <div className="vm-weather-main">
        <div>
          <strong>{fmtTemp(env.payload?.external_temp_c)}</strong>
          <span>{weatherDescription ?? 'Environment telemetry'}</span>
        </div>
        <Thermometer size={25} />
      </div>
      <div className="vm-weather-data">
        <DataRow label="Tomorrow radiation" value={ratio == null ? DASH : `${Math.round(ratio * 100)}% of today`} />
        <DataRow label="GPS" value={satCount == null ? DASH : `${satCount} satellites`} />
      </div>
    </Link>
  );
}
