import type { BatteryGraphicProps, SolarGraphicProps, WeatherGraphicProps } from './types';

/**
 * GENERIC ILLUSTRATED GRAPHICS.
 *
 * This is a VanOS capability, not a theme implementation. A theme may
 * request the "illustrated" drawing for a widget; the drawing consumes
 * only that widget's fixed graphic props and paints through semantic
 * role variables. It never knows which theme selected it.
 *
 * The important distinction is that artwork which contains telemetry
 * numbers is NOT used here. Theme package images can be decorative
 * assets, but a baked screenshot must never become the source of a
 * live reading.
 */

const reduceMotion = `
@media (prefers-reduced-motion: reduce) {
  .vw-illustrated, .vw-illustrated * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
`;

export function IllustratedBattery({ soc, charging, size }: BatteryGraphicProps) {
  const value = soc == null ? 0 : Math.max(0, Math.min(100, soc));
  const known = soc != null;
  const fillHeight = 38 * value / 100;

  return (
    <svg
      className="vw-illustrated"
      width={size}
      height={Math.round(size * 1.2)}
      viewBox="0 0 120 144"
      role="img"
      aria-label={known ? `Battery ${Math.round(value)} percent` : 'Battery state unknown'}
    >
      <style>{reduceMotion}</style>

      <defs>
        <clipPath id="illustratedBatteryClip">
          <rect x="17" y="29" width="86" height="96" rx="12" />
        </clipPath>
        <linearGradient id="illustratedBatteryFill" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="var(--vw-role-charge-fill)" stopOpacity=".95" />
          <stop offset="1" stopColor="var(--vw-role-energy-path)" stopOpacity=".48" />
        </linearGradient>
      </defs>

      <rect x="42" y="8" width="36" height="16" rx="5"
        fill="var(--vw-role-illustration)" opacity=".85" />
      <rect x="10" y="20" width="100" height="118" rx="18"
        fill="var(--vw-panel)" stroke="var(--vw-role-illustration)" strokeWidth="2" />
      <rect x="17" y="29" width="86" height="96" rx="12"
        fill="var(--vw-panel2)" stroke="var(--vw-role-illustration-soft)" />

      {known && (
        <rect
          x="17"
          y={125 - fillHeight}
          width="86"
          height={fillHeight}
          fill="url(#illustratedBatteryFill)"
          clipPath="url(#illustratedBatteryClip)"
        />
      )}

      {!known && (
        <g opacity=".65">
          <path d="M30 108h60M30 88h60M30 68h60M30 48h60"
            stroke="var(--vw-role-illustration-soft)" strokeDasharray="4 5" />
        </g>
      )}

      {/* Small landscape silhouette makes the graphic feel like an
          illustrated object without embedding any theme-specific art. */}
      <path
        d="M20 112 L38 89 L49 103 L64 78 L82 103 L94 91 L102 112 Z"
        fill="var(--vw-role-illustration)"
        opacity=".26"
        clipPath="url(#illustratedBatteryClip)"
      />
      <path
        d="M22 117 C39 108 52 113 66 105 C78 98 91 104 100 98 L100 125 L22 125 Z"
        fill="var(--vw-role-charge-fill)"
        opacity=".20"
        clipPath="url(#illustratedBatteryClip)"
      />

      {charging && known && (
        <rect
          className="vw-battery-sweep"
          x="19"
          y="34"
          width="82"
          height="7"
          rx="3"
          fill="var(--status-amber)"
          opacity=".22"
          clipPath="url(#illustratedBatteryClip)"
        />
      )}

      <style>{`
        .vw-battery-sweep {
          animation: vwIllustratedBatterySweep 2.8s ease-in-out infinite;
        }
        @keyframes vwIllustratedBatterySweep {
          0% { transform: translateY(82px); opacity: 0; }
          35% { opacity: .35; }
          70% { opacity: 0; }
          100% { transform: translateY(0); opacity: 0; }
        }
      `}</style>
    </svg>
  );
}

export function IllustratedSolar({ size, active }: SolarGraphicProps) {
  return (
    <svg
      className="vw-illustrated"
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label="Solar"
    >
      <style>{reduceMotion}</style>
      <defs>
        <radialGradient id="illustratedSolarGlow">
          <stop offset="0" stopColor="var(--vw-role-generation)" stopOpacity=".55" />
          <stop offset="1" stopColor="var(--vw-role-generation)" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="60" cy="45" r="42" fill="url(#illustratedSolarGlow)" />
      <g className={active ? 'vw-solar-pulse' : ''}>
        <circle cx="60" cy="45" r="20" fill="var(--vw-role-generation)" />
        <g stroke="var(--vw-role-generation)" strokeWidth="4" strokeLinecap="round">
          <path d="M60 7v12M60 71v12M22 45H10M110 45H98" />
          <path d="M33 18l9 9M87 63l9 9M87 27l9-9M33 72l9-9" />
        </g>
      </g>

      <path d="M12 103 L34 76 L48 91 L67 64 L88 91 L108 70 L118 103 Z"
        fill="var(--vw-role-illustration)" opacity=".42" />
      <path d="M12 103 C34 94 49 100 66 91 C82 82 96 89 118 80 V108 H12 Z"
        fill="var(--vw-role-generation)" opacity=".22" />

      <style>{`
        .vw-solar-pulse {
          transform-origin: 60px 45px;
          animation: vwIllustratedSolarPulse 2.4s ease-in-out infinite;
        }
        @keyframes vwIllustratedSolarPulse {
          0%, 100% { opacity: .72; transform: scale(.96); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </svg>
  );
}

export function IllustratedWeather({ condition, size }: WeatherGraphicProps) {
  const c = (condition || '').toLowerCase();
  const rain = /rain|drizzle|shower/.test(c);
  const cloudy = /cloud|overcast/.test(c);
  const sunny = !cloudy || /sun|clear/.test(c);

  return (
    <svg
      className="vw-illustrated"
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label={condition || 'Weather'}
    >
      <style>{reduceMotion}</style>
      <defs>
        <linearGradient id="illustratedWeatherSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--vw-role-energy-path)" stopOpacity=".20" />
          <stop offset="1" stopColor="var(--vw-panel)" stopOpacity=".05" />
        </linearGradient>
      </defs>

      <rect x="4" y="4" width="112" height="112" rx="24" fill="url(#illustratedWeatherSky)" />

      {sunny && (
        <g className="vw-weather-sun">
          <circle cx="44" cy="43" r="18" fill="var(--vw-role-generation)" />
          <g stroke="var(--vw-role-generation)" strokeWidth="3" strokeLinecap="round">
            <path d="M44 13v9M44 64v9M14 43h9M65 43h9" />
            <path d="M23 22l7 7M58 57l7 7M65 22l-7 7M30 57l-7 7" />
          </g>
        </g>
      )}

      {cloudy && (
        <path
          d="M27 69h67c10 0 17-6 17-15 0-9-8-16-18-16-3-14-13-22-27-22-13 0-24 8-28 20-2 0-4-1-6-1-10 0-18 7-18 17 0 10 7 17 13 17Z"
          fill="var(--vw-role-illustration)"
          opacity=".72"
        />
      )}

      {rain && (
        <g stroke="var(--vw-role-energy-path)" strokeWidth="4" strokeLinecap="round" className="vw-weather-rain">
          <path d="M43 83l-5 12M61 83l-5 12M79 83l-5 12" />
        </g>
      )}

      <path d="M7 108 L30 84 L45 98 L64 75 L84 99 L104 80 L116 108 Z"
        fill="var(--vw-role-illustration)" opacity=".34" />

      <style>{`
        .vw-weather-sun {
          transform-origin: 44px 43px;
          animation: vwIllustratedWeatherSun 16s linear infinite;
        }
        .vw-weather-rain {
          animation: vwIllustratedWeatherRain 1.2s ease-in-out infinite;
        }
        @keyframes vwIllustratedWeatherSun {
          to { transform: rotate(360deg); }
        }
        @keyframes vwIllustratedWeatherRain {
          0%,100% { opacity: .35; transform: translateY(-2px); }
          50% { opacity: 1; transform: translateY(2px); }
        }
      `}</style>
    </svg>
  );
}
