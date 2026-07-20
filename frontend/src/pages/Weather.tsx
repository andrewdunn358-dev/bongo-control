import { motion } from "framer-motion";
import { useEffect } from "react";
import { CloudSun, Sunrise, Sunset, Droplets, Sun as SunIcon } from "lucide-react";
import Card from "../components/Cards/Card";
import AnimatedNumber from "../components/Cards/AnimatedNumber";
import WeatherIcon, { sceneFromCode } from "../components/Weather/WeatherIcon";
import { useTelemetry } from "../context/TelemetryContext";
import { useLocationContext } from "../context/LocationContext";
import type { DailyWeather } from "../types/telemetry";

function timeOnly(iso: string | null): string {
  if (!iso) return "—";
  // Open-Meteo returns local time as "2026-07-18T05:12" with no zone,
  // so slice rather than parsing into a Date (which would re-interpret
  // it in the browser's timezone and shift it).
  const t = iso.split("T")[1];
  return t ? t.slice(0, 5) : "—";
}

/** Day label from the forecast array index rather than the date string -
 *  index 0 is always today by definition, so this can't drift or break
 *  if the API stops returning a date field. */
function dayLabel(index: number): string {
  if (index === 0) return "Today";
  if (index === 1) return "Tomorrow";
  const d = new Date();
  d.setDate(d.getDate() + index);
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

/** Fraction of daylight elapsed, 0 before sunrise to 1 after sunset. */
function dayProgress(sunrise: string | null, sunset: string | null): number | null {
  if (!sunrise || !sunset) return null;
  const toMinutes = (iso: string) => {
    const t = iso.split("T")[1];
    if (!t) return null;
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const rise = toMinutes(sunrise);
  const set = toMinutes(sunset);
  if (rise === null || set === null || set <= rise) return null;
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  return Math.max(0, Math.min(1, (mins - rise) / (set - rise)));
}

function SunArc({ sunrise, sunset }: { sunrise: string | null; sunset: string | null }) {
  const progress = dayProgress(sunrise, sunset);
  const angle = Math.PI * (progress ?? 0);
  const cx = 110 - 90 * Math.cos(angle);
  const cy = 90 - 60 * Math.sin(angle);
  const isDaytime = progress !== null && progress > 0 && progress < 1;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 220 105" className="w-full max-w-xs" aria-hidden="true">
        <path d="M 20 90 A 90 60 0 0 1 200 90" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth={2} strokeDasharray="3 5" />
        {progress !== null && progress > 0 && (
          <path
            d="M 20 90 A 90 60 0 0 1 200 90"
            fill="none"
            stroke="#ffb000"
            strokeWidth={2}
            strokeDasharray={`${progress * 283} 283`}
            opacity={0.55}
          />
        )}
        <line x1={16} y1={90} x2={204} y2={90} stroke="rgba(255,255,255,0.10)" strokeWidth={1} />
        {isDaytime && (
          <>
            <circle cx={cx} cy={cy} r={11} fill="#ffb000" opacity={0.25} />
            <circle cx={cx} cy={cy} r={6} fill="#ffb000" />
          </>
        )}
      </svg>
      <div className="mt-1 flex w-full max-w-xs justify-between text-xs text-text-muted">
        <span className="flex items-center gap-1">
          <Sunrise size={12} className="text-solar" /> {timeOnly(sunrise)}
        </span>
        <span className="flex items-center gap-1">
          {timeOnly(sunset)} <Sunset size={12} className="text-solar" />
        </span>
      </div>
    </div>
  );
}

/** One day in the forecast row. Deliberately compact and uniform -
 *  the whole point of the tile row is that it scans left-to-right at a
 *  glance, which breaks the moment tiles differ in size or detail. */
function DayTile({ day, index }: { day: DailyWeather; index: number }) {
  const isToday = index === 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
      className={`flex flex-col items-center gap-2 rounded-2xl border p-3 text-center transition-colors ${
        isToday ? "border-solar/25 bg-solar/[0.07]" : "border-white/[0.06] bg-white/[0.02]"
      }`}
    >
      <div className={`text-[0.65rem] font-bold uppercase tracking-[0.16em] ${isToday ? "text-solar" : "text-text-muted"}`}>
        {dayLabel(index)}
      </div>
      <WeatherIcon scene={sceneFromCode(day.weather_code)} size={46} />
      <div className="font-mono text-lg font-semibold leading-none text-text-primary">
        {day.temp_max_c != null ? `${Math.round(day.temp_max_c)}°` : "—"}
      </div>
      <div className="font-mono text-xs text-text-muted">{day.temp_min_c != null ? `${Math.round(day.temp_min_c)}°` : "—"}</div>
      {day.precipitation_probability_max_pct != null && day.precipitation_probability_max_pct > 0 && (
        <div className="flex items-center gap-0.5 text-[0.65rem] text-[#6FA5D2]">
          <Droplets size={9} />
          {day.precipitation_probability_max_pct}%
        </div>
      )}
    </motion.div>
  );
}

export default function Weather() {
  const { state } = useTelemetry();
  const { ensureFresh } = useLocationContext();
  const weather = state.weather?.payload;
  const outlook = state.system?.payload.tomorrow_outlook;

  useEffect(() => {
    ensureFresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!weather) {
    return (
      <Card label="Weather" icon={<CloudSun size={14} />}>
        <p className="text-sm text-text-muted">
          No forecast yet — set a location in Settings → General, then enable the Weather plugin in Settings → Plugins.
        </p>
      </Card>
    );
  }

  const scene = sceneFromCode(weather.current_weather_code);
  // Fall back to today/tomorrow if an older backend hasn't got the
  // forecast array yet - avoids an empty row mid-upgrade.
  const forecast = weather.forecast?.length ? weather.forecast : [weather.today, weather.tomorrow];

  return (
    <div className="space-y-4">
      {/* Hero - signage-style: one dominant number, readable across the van,
          minimal chrome. Everything else is support. */}
      <div className="relative overflow-hidden rounded-[1.75rem] border border-white/[0.07] bg-surface-card">
        <div
          className="pointer-events-none absolute -inset-1/2 opacity-70"
          style={{
            background:
              scene === "clear" || scene === "partly"
                ? "radial-gradient(circle at 70% 25%, rgba(255,176,0,0.16), transparent 55%)"
                : "radial-gradient(circle at 70% 25%, rgba(111,165,210,0.14), transparent 55%)",
          }}
        />
        <div className="relative flex flex-col items-center gap-6 p-7 sm:flex-row sm:justify-between sm:gap-10 sm:p-9">
          <div className="text-center sm:text-left">
            <div className="text-[0.7rem] font-bold uppercase tracking-[0.22em] text-text-muted">Right now</div>
            <div className="mt-3 font-mono text-7xl font-semibold leading-none tracking-[-0.05em] text-white sm:text-8xl">
              {weather.current_temp_c != null ? <AnimatedNumber value={weather.current_temp_c} decimals={0} suffix="°" /> : "—"}
            </div>
            <div className="mt-3 text-xl capitalize text-text-secondary">{weather.current_weather_description}</div>
            {weather.current_cloud_cover_pct != null && (
              <div className="mt-1 text-sm text-text-muted">{Math.round(weather.current_cloud_cover_pct)}% cloud cover</div>
            )}
          </div>
          <motion.div initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5 }}>
            <WeatherIcon scene={scene} size={150} />
          </motion.div>
        </div>
      </div>

      {/* Forecast tile row - the Xibo-style bit: scans left to right,
          uniform tiles, no card chrome between them. */}
      <div className="rounded-[1.75rem] border border-white/[0.07] bg-surface-card p-4 sm:p-5">
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
          {forecast.slice(0, 5).map((day, i) => (
            <DayTile key={day.date ?? i} day={day} index={i} />
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card label="Daylight" icon={<SunIcon size={14} />} accent="solar" index={2}>
          <SunArc sunrise={weather.today.sunrise} sunset={weather.today.sunset} />
        </Card>

        {outlook && (
          <Card label="Solar Outlook" icon={<SunIcon size={14} />} accent="battery" index={3}>
            <div className="space-y-3">
              <p className="text-sm text-text-primary">{outlook.recommendation}</p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-surface-raised px-3 py-2">
                  <div className="text-xs uppercase tracking-wide text-text-muted">Today</div>
                  <div className="font-mono text-text-primary">
                    {weather.today.shortwave_radiation_sum_mj != null
                      ? `${weather.today.shortwave_radiation_sum_mj.toFixed(1)} MJ/m²`
                      : "—"}
                  </div>
                </div>
                <div className="rounded-lg bg-surface-raised px-3 py-2">
                  <div className="text-xs uppercase tracking-wide text-text-muted">Tomorrow</div>
                  <div className="font-mono text-text-primary">
                    {weather.tomorrow.shortwave_radiation_sum_mj != null
                      ? `${weather.tomorrow.shortwave_radiation_sum_mj.toFixed(1)} MJ/m²`
                      : "—"}
                  </div>
                </div>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
