import { Cloud, CloudRain, CloudSnow, Sun, CloudSun, CloudFog, Wind, Sunrise, Sunset } from 'lucide-react';
import { GlassCard, CardHeader } from '@/components/primitives/GlassCard';
import { StatusPill } from '@/components/primitives/StatusPill';
import { useWeather } from '@/lib/telemetry';
import { fmtTemp, fmtMJ, fmtLocalTime, fmtPct, wmoLabel, DASH } from '@/lib/format';
import type { DailyWeather } from '@/lib/types';
import { WEATHER } from '@/constants/testIds';

function iconFor(code: number | null | undefined) {
  if (code === 0) return { Icon: Sun, color: '#f59e0b' };
  if (code !== null && code !== undefined && [1, 2].includes(code)) return { Icon: CloudSun, color: '#38bdf8' };
  if (code === 3) return { Icon: Cloud, color: '#94a3b8' };
  if (code !== null && code !== undefined && [45, 48].includes(code)) return { Icon: CloudFog, color: '#94a3b8' };
  if (code !== null && code !== undefined && code >= 51 && code <= 67) return { Icon: CloudRain, color: '#22d3ee' };
  if (code !== null && code !== undefined && code >= 71 && code <= 77) return { Icon: CloudSnow, color: '#a5f3fc' };
  if (code !== null && code !== undefined && code >= 80 && code <= 82) return { Icon: CloudRain, color: '#22d3ee' };
  if (code !== null && code !== undefined && code >= 95) return { Icon: CloudRain, color: '#a855f7' };
  return { Icon: Cloud, color: '#94a3b8' };
}

function DailyTile({ label, day, testId }: { label: string; day: DailyWeather | undefined; testId?: string }) {
  if (!day) {
    return (
      <div data-testid={testId} className="rounded-2xl p-4 bg-ink/[0.03] ring-1 ring-inset ring-ink/10">
        <div className="text-[11px] uppercase tracking-widest text-ink-muted">{label}</div>
        <div className="text-ink-faint mt-2 text-sm">{DASH} — no forecast yet</div>
      </div>
    );
  }
  const meta = iconFor(day.weather_code);
  const Icon = meta.Icon;
  return (
    <div data-testid={testId} className="rounded-2xl p-4 bg-ink/[0.03] ring-1 ring-inset ring-ink/10">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-widest text-ink-muted">{label}</div>
        <Icon size={22} color={meta.color} />
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <div className="num text-2xl">{fmtTemp(day.temp_max_c)}</div>
        <div className="num text-sm text-ink-muted">{fmtTemp(day.temp_min_c)}</div>
      </div>
      <div className="mt-2 text-xs text-ink-soft">{day.weather_description || wmoLabel(day.weather_code)}</div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-ink-muted">
        <span>rain {fmtPct(day.precipitation_probability_max_pct)}</span>
        <span className="text-aurora-teal">{fmtMJ(day.shortwave_radiation_sum_mj)}</span>
      </div>
    </div>
  );
}

export function Weather() {
  const w = useWeather();
  const p = w.payload;
  const meta = iconFor(p?.current_weather_code);
  const CurIcon = meta.Icon;
  const ratio = p?.tomorrow_vs_today_radiation_ratio ?? null;

  return (
    <div data-testid={WEATHER.root} className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 py-6 lg:py-10">
      <div className="mb-6">
        <div className="text-[11px] uppercase tracking-[0.24em] text-ink-muted">Weather + solar outlook</div>
        <h1 className="text-3xl md:text-5xl font-semibold tracking-tight mt-1">Sky over the <span className="text-aurora-teal">van</span></h1>
        <div className="text-sm text-ink-muted mt-2">Forecast arrives via the telemetry WebSocket &mdash; irradiance drives what solar we can expect.</div>
      </div>

      <div className="grid grid-cols-12 gap-4 lg:gap-6">
        <GlassCard glow="teal" className="col-span-12 lg:col-span-5 p-6 lg:p-8" data-testid={WEATHER.currentTemp}>
          <CardHeader label="Now" hint={p?.current_weather_description || wmoLabel(p?.current_weather_code)} right={<StatusPill tone="teal">{w.source ? String(w.source).toUpperCase() : 'LIVE'}</StatusPill>} />
          <div className="flex items-center gap-6">
            <div className="h-20 w-20 rounded-3xl grid place-items-center bg-ink/[0.04] ring-1 ring-inset ring-ink/10">
              <CurIcon size={48} color={meta.color} />
            </div>
            <div>
              <div className="num text-6xl font-semibold leading-none">{fmtTemp(p?.current_temp_c)}</div>
              <div className="text-sm text-ink-muted mt-2" data-testid={WEATHER.currentDesc}>{p?.current_weather_description || DASH}</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-6">
            <div className="rounded-xl bg-ink/[0.03] ring-1 ring-ink/10 p-3">
              <div className="text-[10px] uppercase tracking-widest text-ink-muted flex items-center gap-1"><Cloud size={12}/> Cloud</div>
              <div className="num text-lg mt-1">{fmtPct(p?.current_cloud_cover_pct)}</div>
            </div>
            <div className="rounded-xl bg-ink/[0.03] ring-1 ring-ink/10 p-3">
              <div className="text-[10px] uppercase tracking-widest text-ink-muted flex items-center gap-1"><Sunrise size={12}/> Sunrise</div>
              <div className="num text-lg mt-1">{fmtLocalTime(p?.today?.sunrise)}</div>
            </div>
            <div className="rounded-xl bg-ink/[0.03] ring-1 ring-ink/10 p-3">
              <div className="text-[10px] uppercase tracking-widest text-ink-muted flex items-center gap-1"><Sunset size={12}/> Sunset</div>
              <div className="num text-lg mt-1">{fmtLocalTime(p?.today?.sunset)}</div>
            </div>
          </div>
        </GlassCard>

        <GlassCard glow="purple" className="col-span-12 lg:col-span-7 p-6" data-testid={WEATHER.irradianceRatio}>
          <CardHeader label="Solar outlook" hint="tomorrow vs today, by shortwave radiation" right={<StatusPill tone="purple">MJ/m²</StatusPill>} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DailyTile label="Today" day={p?.today} testId={WEATHER.todayCard} />
            <DailyTile label="Tomorrow" day={p?.tomorrow} testId={WEATHER.tomorrowCard} />
          </div>
          <div className="mt-5 rounded-2xl bg-ink/[0.03] ring-1 ring-inset ring-ink/10 p-4">
            <div className="text-[11px] uppercase tracking-widest text-ink-muted">Tomorrow vs today ratio</div>
            <div className="flex items-baseline gap-2 mt-1">
              <div className="num text-3xl">{ratio === null || ratio === undefined ? DASH : `${(ratio * 100).toFixed(0)}%`}</div>
              <div className="text-xs text-ink-faint">of today&apos;s expected irradiance</div>
            </div>
            <div className="mt-2 h-2 rounded-full bg-ink/5 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-aurora-teal via-aurora-blue to-aurora-purple" style={{ width: `${Math.max(0, Math.min(200, (ratio ?? 0) * 100))}%` }} />
            </div>
          </div>
        </GlassCard>

        <GlassCard className="col-span-12 p-6" data-testid={WEATHER.forecastList}>
          <CardHeader label="5-day outlook" hint="highs / lows · rain probability · solar MJ" />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {(p?.forecast || []).slice(0, 5).map((d, i) => (
              <DailyTile key={d?.date ?? i} label={d?.date ? d.date.slice(5) : `Day ${i + 1}`} day={d} />
            ))}
            {(!p?.forecast || p.forecast.length === 0) && (
              <div className="col-span-full text-sm text-ink-faint">Forecast not received yet.</div>
            )}
          </div>
        </GlassCard>

        <div className="col-span-12 flex flex-wrap gap-2 items-center text-[11px] text-ink-faint">
          <Wind size={12} /> Weather source: Open-Meteo via the backend&apos;s <span className="num">weather</span> WS domain. Sunrise/sunset are local times — no timezone shift applied.
        </div>
      </div>
    </div>
  );
}
