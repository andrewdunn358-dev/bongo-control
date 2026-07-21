import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Cloud, CloudRain, CloudSnow, Sun, CloudSun, CloudFog, Wind, Droplets, Sunrise, Sunset } from 'lucide-react';
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { endpoints } from '@/lib/api';
import { GlassCard, CardHeader } from '@/components/primitives/GlassCard';
import { StatusPill } from '@/components/primitives/StatusPill';
import { fmtTemp } from '@/lib/format';
import { WEATHER } from '@/constants/testIds';

const DEFAULT_CENTER = { lat: 45.5231, lng: -122.6765 };

const wmoIcon = (code) => {
  if (code === 0) return { Icon: Sun, label: 'Clear', color: '#f59e0b' };
  if ([1, 2].includes(code)) return { Icon: CloudSun, label: 'Partly cloudy', color: '#38bdf8' };
  if (code === 3) return { Icon: Cloud, label: 'Overcast', color: '#94a3b8' };
  if ([45, 48].includes(code)) return { Icon: CloudFog, label: 'Fog', color: '#94a3b8' };
  if (code >= 51 && code <= 67) return { Icon: CloudRain, label: 'Rain', color: '#22d3ee' };
  if (code >= 71 && code <= 77) return { Icon: CloudSnow, label: 'Snow', color: '#a5f3fc' };
  if (code >= 80 && code <= 82) return { Icon: CloudRain, label: 'Showers', color: '#22d3ee' };
  if (code >= 95) return { Icon: CloudRain, label: 'Thunder', color: '#a855f7' };
  return { Icon: Cloud, label: '—', color: '#94a3b8' };
};

const dayLabel = (dateStr, i) => {
  if (i === 0) return 'Today';
  if (i === 1) return 'Tmrw';
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { weekday: 'short' });
};

export const Weather = () => {
  const [center, setCenter] = useState(DEFAULT_CENTER);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setCenter({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {},
      { enableHighAccuracy: false, timeout: 3000 },
    );
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ['weather', center.lat, center.lng],
    queryFn: () => endpoints.weather(center.lat, center.lng),
    staleTime: 15 * 60 * 1000,
  });

  const cur = data?.current;
  const daily = data?.daily;
  const outlook = data?.solar_outlook;

  const curMeta = wmoIcon(cur?.weather_code ?? 0);
  const CurIcon = curMeta.Icon;

  // Build dual bar chart data (today vs tomorrow by hour 0..23)
  const chartData = Array.from({ length: 24 }, (_, hour) => {
    const t = outlook?.today?.find((x) => x.hour === hour)?.wm2 ?? 0;
    const tm = outlook?.tomorrow?.find((x) => x.hour === hour)?.wm2 ?? 0;
    return { hour: `${String(hour).padStart(2, '0')}:00`, Today: Math.round(t), Tomorrow: Math.round(tm) };
  });

  return (
    <div data-testid={WEATHER.root} className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 py-6 lg:py-10">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Weather + solar outlook</div>
          <h1 className="text-3xl md:text-5xl font-semibold text-white tracking-tight mt-1">
            Sky over the <span className="text-aurora-teal">van</span>
          </h1>
          <div className="text-sm text-slate-400 mt-2">
            7-day forecast · irradiance today vs tomorrow · powered by Open-Meteo.
          </div>
        </div>
        <StatusPill tone="teal">{isLoading ? 'FETCHING…' : 'LIVE'}</StatusPill>
      </div>

      <div className="grid grid-cols-12 gap-4 lg:gap-6">
        <GlassCard glow="teal" className="col-span-12 lg:col-span-5 p-6 lg:p-8" data-testid={WEATHER.currentCard}>
          <CardHeader label="Now" hint={`${center.lat.toFixed(2)}, ${center.lng.toFixed(2)}`} right={<StatusPill tone="teal">{curMeta.label.toUpperCase()}</StatusPill>} />
          <div className="flex items-center gap-6">
            <div className="h-24 w-24 rounded-3xl grid place-items-center bg-white/[0.04] ring-1 ring-inset ring-white/10">
              <CurIcon size={54} color={curMeta.color} />
            </div>
            <div>
              <div className="num text-6xl font-semibold text-white leading-none">{fmtTemp(cur?.temperature_2m ?? 0)}</div>
              <div className="text-sm text-slate-400 mt-2">Feels like {fmtTemp(cur?.apparent_temperature ?? 0)}</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-6">
            <div className="rounded-xl bg-white/[0.03] ring-1 ring-white/10 p-3">
              <div className="text-[10px] uppercase tracking-widest text-slate-400 flex items-center gap-1"><Wind size={12} /> Wind</div>
              <div className="num text-lg text-white mt-1">{Math.round(cur?.wind_speed_10m ?? 0)} <span className="text-xs text-slate-400">km/h</span></div>
            </div>
            <div className="rounded-xl bg-white/[0.03] ring-1 ring-white/10 p-3">
              <div className="text-[10px] uppercase tracking-widest text-slate-400 flex items-center gap-1"><Droplets size={12} /> Humidity</div>
              <div className="num text-lg text-white mt-1">{Math.round(cur?.relative_humidity_2m ?? 0)}%</div>
            </div>
            <div className="rounded-xl bg-white/[0.03] ring-1 ring-white/10 p-3">
              <div className="text-[10px] uppercase tracking-widest text-slate-400 flex items-center gap-1"><Cloud size={12} /> Cloud</div>
              <div className="num text-lg text-white mt-1">{Math.round(cur?.cloud_cover ?? 0)}%</div>
            </div>
          </div>
          {daily && (
            <div className="mt-6 flex items-center justify-between text-sm text-slate-300">
              <span className="flex items-center gap-2"><Sunrise size={16} className="text-aurora-teal" /> {daily.sunrise?.[0]?.slice(11, 16)}</span>
              <span className="flex items-center gap-2"><Sunset size={16} className="text-aurora-purple" /> {daily.sunset?.[0]?.slice(11, 16)}</span>
            </div>
          )}
        </GlassCard>

        <GlassCard className="col-span-12 lg:col-span-7 p-6" data-testid={WEATHER.solarChart}>
          <CardHeader label="Solar irradiance · today vs tomorrow" hint="W/m² per hour" right={<div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-aurora-teal" /> Today</span>
            <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-aurora-purple" /> Tomorrow</span>
          </div>} />
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
                <XAxis dataKey="hour" tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false} axisLine={false} interval={2} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: 'rgba(15,41,66,0.9)', border: '1px solid rgba(34,211,238,0.3)', borderRadius: 12, color: '#e6f0ff' }}
                  cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                />
                <Legend wrapperStyle={{ display: 'none' }} />
                <Bar dataKey="Today" fill="#22d3ee" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Tomorrow" fill="#a855f7" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>

        <GlassCard className="col-span-12 p-6" data-testid={WEATHER.forecastList}>
          <CardHeader label="7-day forecast" hint="Highs / lows · precip · solar sum" />
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {(daily?.time || []).map((d, i) => {
              const meta = wmoIcon(daily.weather_code?.[i] ?? 0);
              const Icon = meta.Icon;
              return (
                <div key={d} className="rounded-2xl p-4 bg-white/[0.03] ring-1 ring-white/10 hover:bg-white/[0.05] transition">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] uppercase tracking-widest text-slate-400">{dayLabel(d, i)}</div>
                    <Icon size={20} color={meta.color} />
                  </div>
                  <div className="mt-2 flex items-baseline gap-1.5">
                    <div className="num text-2xl text-white">{Math.round(daily.temperature_2m_max?.[i] ?? 0)}°</div>
                    <div className="num text-sm text-slate-500">{Math.round(daily.temperature_2m_min?.[i] ?? 0)}°</div>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
                    <span>{(daily.precipitation_sum?.[i] ?? 0).toFixed(1)} mm</span>
                    <span className="text-aurora-teal">{(daily.shortwave_radiation_sum?.[i] ?? 0).toFixed(1)} MJ</span>
                  </div>
                </div>
              );
            })}
          </div>
        </GlassCard>
      </div>
    </div>
  );
};
