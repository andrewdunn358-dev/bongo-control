import { motion } from "framer-motion";
import { CloudSun, Sunrise, Sunset, Droplets, Thermometer, Sun as SunIcon } from "lucide-react";
import Card from "../components/Cards/Card";
import AnimatedNumber from "../components/Cards/AnimatedNumber";
import WeatherIcon, { sceneFromCode } from "../components/Weather/WeatherIcon";
import { useTelemetry } from "../context/TelemetryContext";
import type { DailyWeather } from "../types/telemetry";

function timeOnly(iso: string | null): string {
  if (!iso) return "—";
  // Open-Meteo returns local time as "2026-07-18T05:12" with no zone,
  // so slice rather than parsing into a Date (which would re-interpret
  // it in the browser's timezone and shift it).
  const t = iso.split("T")[1];
  return t ? t.slice(0, 5) : "—";
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
  // Semicircle from (20,90) to (200,90), peaking at the top.
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
            stroke="#f0a84e"
            strokeWidth={2}
            strokeDasharray={`${progress * 283} 283`}
            opacity={0.55}
          />
        )}
        <line x1={16} y1={90} x2={204} y2={90} stroke="rgba(255,255,255,0.10)" strokeWidth={1} />
        {isDaytime && (
          <>
            <circle cx={cx} cy={cy} r={11} fill="#f0a84e" opacity={0.25} />
            <circle cx={cx} cy={cy} r={6} fill="#f0a84e" />
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

function ForecastCard({ label, day, index }: { label: string; day: DailyWeather; index: number }) {
  return (
    <Card label={label} icon={<CloudSun size={14} />} index={index}>
      <div className="flex items-center gap-4">
        <WeatherIcon scene={sceneFromCode(day.weather_code)} size={72} />
        <div className="min-w-0">
          <div className="font-mono text-xl font-semibold tabular-nums text-text-primary">
            {day.temp_max_c !== null ? `${Math.round(day.temp_max_c)}°` : "—"}
            <span className="ml-2 text-base font-normal text-text-muted">
              {day.temp_min_c !== null ? `${Math.round(day.temp_min_c)}°` : "—"}
            </span>
          </div>
          <div className="truncate text-sm capitalize text-text-secondary">{day.weather_description}</div>
          {day.precipitation_probability_max_pct !== null && (
            <div className="mt-1 flex items-center gap-1 text-xs text-text-muted">
              <Droplets size={11} className="text-[#4a9eea]" />
              {day.precipitation_probability_max_pct}% chance of rain
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function Weather() {
  const { state } = useTelemetry();
  const weather = state.weather?.payload;
  const outlook = state.system?.payload.tomorrow_outlook;

  if (!weather) {
    return (
      <Card label="Weather" icon={<CloudSun size={14} />}>
        <p className="text-sm text-text-muted">
          No forecast yet — set a location in Settings → General, then enable the Weather plugin in Settings → Plugins.
        </p>
      </Card>
    );
  }

  const scene = sceneFromCode(weather.today.weather_code);

  return (
    <div className="space-y-4">
      {/* Hero: big animated conditions, MagicMirror-style */}
      <Card label="Right Now" accent="solar" index={0}>
        <div className="flex flex-col items-center gap-2 py-2 sm:flex-row sm:justify-center sm:gap-10">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5 }}>
            <WeatherIcon scene={scene} size={150} />
          </motion.div>
          <div className="text-center sm:text-left">
            <div className="font-mono text-5xl font-semibold tabular-nums text-text-primary md:text-6xl">
              {weather.current_temp_c !== null ? <AnimatedNumber value={weather.current_temp_c} decimals={0} suffix="°" /> : "—"}
            </div>
            <div className="mt-1 text-lg capitalize text-text-secondary">{weather.today.weather_description}</div>
            {weather.current_cloud_cover_pct !== null && (
              <div className="mt-1 text-sm text-text-muted">{Math.round(weather.current_cloud_cover_pct)}% cloud cover</div>
            )}
          </div>
        </div>
      </Card>

      {/* Daylight arc — genuinely useful here, not decoration: it's the
          window in which solar can actually produce anything. */}
      <Card label="Daylight" icon={<SunIcon size={14} />} accent="solar" index={1}>
        <SunArc sunrise={weather.today.sunrise} sunset={weather.today.sunset} />
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ForecastCard label="Today" day={weather.today} index={2} />
        <ForecastCard label="Tomorrow" day={weather.tomorrow} index={3} />
      </div>

      {outlook && (
        <Card label="Solar Outlook" icon={<SunIcon size={14} />} accent="battery" index={4}>
          <div className="space-y-3">
            <p className="text-sm text-text-primary">{outlook.recommendation}</p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg bg-surface-raised px-3 py-2">
                <div className="text-xs uppercase tracking-wide text-text-muted">Solar energy today</div>
                <div className="font-mono text-text-primary">
                  {weather.today.shortwave_radiation_sum_mj !== null
                    ? `${weather.today.shortwave_radiation_sum_mj.toFixed(1)} MJ/m²`
                    : "—"}
                </div>
              </div>
              <div className="rounded-lg bg-surface-raised px-3 py-2">
                <div className="text-xs uppercase tracking-wide text-text-muted">Tomorrow</div>
                <div className="font-mono text-text-primary">
                  {weather.tomorrow.shortwave_radiation_sum_mj !== null
                    ? `${weather.tomorrow.shortwave_radiation_sum_mj.toFixed(1)} MJ/m²`
                    : "—"}
                </div>
              </div>
            </div>
          </div>
        </Card>
      )}

      <Card label="Temperature Range" icon={<Thermometer size={14} />} index={5}>
        <div className="flex items-center justify-around text-center">
          <div>
            <div className="text-xs uppercase tracking-wide text-text-muted">Today high</div>
            <div className="font-mono text-2xl tabular-nums text-solar">
              {weather.today.temp_max_c !== null ? `${Math.round(weather.today.temp_max_c)}°` : "—"}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-text-muted">Tonight low</div>
            <div className="font-mono text-2xl tabular-nums text-[#4a9eea]">
              {weather.today.temp_min_c !== null ? `${Math.round(weather.today.temp_min_c)}°` : "—"}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
