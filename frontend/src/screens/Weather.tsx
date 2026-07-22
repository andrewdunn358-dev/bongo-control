import { Cloud, CloudRain, CloudSnow, Sun, CloudSun, CloudFog, Sunset } from 'lucide-react';
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

/** Short weekday from an ISO date, e.g. "2026-07-22" -> "TUE". */
function weekday(date: string | null | undefined, i: number): string {
  if (!date) return `D${i + 1}`;
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date.slice(5);
  return d.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase();
}

/** One column in the 7-day strip. */
function DayCol({ date, day, i }: { date?: string | null; day: DailyWeather | undefined; i: number }) {
  const meta = iconFor(day?.weather_code);
  const Icon = meta.Icon;
  return (
    <div className="flex-1 min-w-0 text-center rounded-xl bg-ink/[0.03] ring-1 ring-inset ring-ink/10 py-3 px-1">
      <div className="text-[10px] uppercase tracking-widest text-ink-muted">{weekday(date ?? day?.date, i)}</div>
      <div className="grid place-items-center my-1.5"><Icon size={18} color={meta.color} /></div>
      <div className="num text-xs">
        {day ? fmtTemp(day.temp_max_c) : DASH}
        <span className="text-ink-faint"> / {day ? fmtTemp(day.temp_min_c) : DASH}</span>
      </div>
    </div>
  );
}

export function Weather() {
  const w = useWeather();
  const p = w.payload;
  const meta = iconFor(p?.current_weather_code);
  const CurIcon = meta.Icon;

  const todayMj = p?.today?.shortwave_radiation_sum_mj ?? null;
  const tomorrowMj = p?.tomorrow?.shortwave_radiation_sum_mj ?? null;
  const ratio = p?.tomorrow_vs_today_radiation_ratio ?? null;
  const maxMj = Math.max(todayMj ?? 0, tomorrowMj ?? 0, 1);
  const barH = (mj: number | null) => (mj == null ? 0 : Math.max(4, Math.round((mj / maxMj) * 150)));

  const days = (p?.forecast && p.forecast.length ? p.forecast : [p?.today, p?.tomorrow]).slice(0, 7);

  return (
    <div data-testid={WEATHER.root} className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 py-6 lg:py-10">
      <div className="mb-6">
        <div className="text-[11px] uppercase tracking-[0.24em] text-ink-muted">Weather + solar outlook</div>
        <h1 className="text-3xl md:text-5xl font-semibold tracking-tight mt-1">
          Weather &amp; <span className="text-aurora-teal">solar outlook</span>
        </h1>
        <div className="text-sm text-ink-muted mt-2">Open-Meteo forecast &mdash; tomorrow&apos;s solar compared to today.</div>
      </div>

      <div className="grid grid-cols-12 gap-4 lg:gap-6">
        {/* Current conditions + 7-day strip */}
        <GlassCard glow="teal" className="col-span-12 lg:col-span-6 p-6" data-testid={WEATHER.currentTemp}>
          <CardHeader
            label="Current conditions"
            right={<StatusPill tone="teal">{w.source ? String(w.source).toUpperCase() : 'LIVE'}</StatusPill>}
          />
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="num text-6xl font-semibold leading-none">{fmtTemp(p?.current_temp_c)}</div>
              <div className="text-sm text-ink-muted mt-2 flex flex-wrap items-center gap-x-2" data-testid={WEATHER.currentDesc}>
                <span>{p?.current_weather_description || wmoLabel(p?.current_weather_code)}</span>
                {p?.current_cloud_cover_pct != null && <span className="text-ink-faint">· cloud {fmtPct(p.current_cloud_cover_pct)}</span>}
                {p?.today?.sunset && (
                  <span className="text-ink-faint inline-flex items-center gap-1">
                    · <Sunset size={12} /> {fmtLocalTime(p.today.sunset)}
                  </span>
                )}
              </div>
            </div>
            <div className="h-20 w-20 shrink-0 rounded-3xl grid place-items-center bg-ink/[0.04] ring-1 ring-inset ring-ink/10">
              <CurIcon size={44} color={meta.color} />
            </div>
          </div>

          <div className="mt-6 flex gap-1.5" data-testid={WEATHER.forecastList}>
            {days.length && days.some(Boolean) ? (
              days.map((d, i) => <DayCol key={d?.date ?? i} date={d?.date} day={d ?? undefined} i={i} />)
            ) : (
              <div className="text-sm text-ink-faint py-3">Forecast not received yet.</div>
            )}
          </div>
        </GlassCard>

        {/* Solar outlook — today vs tomorrow bars */}
        <GlassCard glow="purple" className="col-span-12 lg:col-span-6 p-6" data-testid={WEATHER.irradianceRatio}>
          <CardHeader label="Solar outlook" hint="tomorrow vs today, by shortwave radiation" right={<StatusPill tone="purple">MJ/m²</StatusPill>} />

          <div className="flex items-end justify-center gap-8 h-[170px] mt-2">
            <div className="flex flex-col items-center justify-end h-full" data-testid={WEATHER.todayCard}>
              <div className="num text-sm text-aurora-teal mb-2">{todayMj == null ? DASH : fmtMJ(todayMj)}</div>
              <div
                className="w-20 rounded-t-lg bg-gradient-to-b from-aurora-teal to-aurora-teal/25"
                style={{ height: `${barH(todayMj)}px`, boxShadow: '0 0 22px rgba(34,211,238,0.3)' }}
              />
              <div className="text-[11px] uppercase tracking-widest text-ink-muted mt-2">Today</div>
            </div>
            <div className="flex flex-col items-center justify-end h-full" data-testid={WEATHER.tomorrowCard}>
              <div className="num text-sm text-aurora-purple mb-2">{tomorrowMj == null ? DASH : fmtMJ(tomorrowMj)}</div>
              <div
                className="w-20 rounded-t-lg bg-gradient-to-b from-aurora-purple to-aurora-purple/25"
                style={{ height: `${barH(tomorrowMj)}px`, boxShadow: '0 0 22px rgba(168,85,247,0.3)' }}
              />
              <div className="text-[11px] uppercase tracking-widest text-ink-muted mt-2">Tomorrow</div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl bg-ink/[0.03] ring-1 ring-inset ring-ink/10 p-4">
            <div className="flex items-baseline gap-2">
              <div className="num text-2xl">{ratio == null ? DASH : `${Math.round(ratio * 100)}%`}</div>
              <div className="text-xs text-ink-faint">of today&apos;s expected solar tomorrow</div>
            </div>
            <div className="mt-2 h-2 rounded-full bg-ink/10 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-aurora-teal via-aurora-blue to-aurora-purple"
                style={{ width: `${Math.max(0, Math.min(100, (ratio ?? 0) * 100))}%` }}
              />
            </div>
          </div>
        </GlassCard>

        <div className="col-span-12 text-[11px] text-ink-faint">
          Weather source: Open-Meteo via the backend&apos;s <span className="num">weather</span> WS domain. Sunrise/sunset are local times.
        </div>
      </div>
    </div>
  );
}
