/* VanOS custom telemetry graphics.
   These are actual inline SVG components, not icon-library placeholders.
   All animation is CSS/SVG only.
*/

const reducedMotion = `
@media (prefers-reduced-motion: reduce) {
  .vanos-animated, .vanos-animated * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
`;

export function VanOSBattery({
  soc = 95,
  charging = false,
  size = 52,
}: {
  soc?: number | null;
  charging?: boolean;
  size?: number;
}) {
  const value = Math.max(0, Math.min(100, soc ?? 0));
  const fill =
    value < 50 ? "#f0645b" : value < 70 ? "#f2b84b" : "#32d583";

  return (
    <svg
      className="vanos-animated"
      width={size}
      height={Math.round(size * 1.2)}
      viewBox="0 0 52 62"
      aria-label={`Battery ${Math.round(value)} percent`}
      role="img"
    >
      <style>{reducedMotion}</style>

      {/* terminal */}
      <rect x="18" y="1.5" width="16" height="7" rx="2.5"
        fill="#8f9daa" />

      {/* outer shell */}
      <rect x="7" y="7" width="38" height="50" rx="7"
        fill="#0b1219" stroke="#8f9daa" strokeWidth="2" />

      {/* inner well */}
      <rect x="11.5" y="11.5" width="29" height="41"
        rx="4.5" fill="#17222d" stroke="#304050" strokeWidth="1" />

      {/* charge */}
      <clipPath id="vanosBatteryClip">
        <rect x="12.5" y="12.5" width="27" height="39" rx="3.5" />
      </clipPath>

      <rect
        x="12.5"
        y={51.5 - (39 * value / 100)}
        width="27"
        height={39 * value / 100}
        fill={fill}
        clipPath="url(#vanosBatteryClip)"
      />

      {/* subtle charge segments */}
      <g opacity=".18" stroke="#ffffff" strokeWidth="1">
        <path d="M14 22h24" />
        <path d="M14 32h24" />
        <path d="M14 42h24" />
      </g>

      {/* charging sweep */}
      {charging && (
        <rect
          className="battery-sweep"
          x="13"
          y="13"
          width="25"
          height="4"
          rx="2"
          fill="#ffffff"
          opacity=".28"
          clipPath="url(#vanosBatteryClip)"
        />
      )}

      <style>{`
        .battery-sweep {
          animation: vanosBatterySweep 2.8s ease-in-out infinite;
        }
        @keyframes vanosBatterySweep {
          0% { transform: translateY(31px); opacity: 0; }
          35% { opacity: .35; }
          70% { opacity: 0; }
          100% { transform: translateY(-1px); opacity: 0; }
        }
      `}</style>
    </svg>
  );
}

export function VanOSSolar({
  size = 48,
  active = true,
}: {
  size?: number;
  active?: boolean;
}) {
  return (
    <svg
      className="vanos-animated"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-label="Solar"
      role="img"
    >
      <style>{reducedMotion}</style>

      <g className={active ? "solar-rays" : ""}>
        <g stroke="#f5c451" strokeWidth="2" strokeLinecap="round">
          <path d="M24 3V9" />
          <path d="M24 39V45" />
          <path d="M3 24H9" />
          <path d="M39 24H45" />
          <path d="M9.15 9.15L13.4 13.4" />
          <path d="M34.6 34.6L38.85 38.85" />
          <path d="M38.85 9.15L34.6 13.4" />
          <path d="M13.4 34.6L9.15 38.85" />
        </g>
      </g>

      <circle cx="24" cy="24" r="7.5" fill="#f5c451" />
      <circle cx="21.5" cy="21.5" r="2" fill="#fff4c7" opacity=".55" />

      <style>{`
        .solar-rays {
          transform-origin: 24px 24px;
          animation: vanosSolarRotate 18s linear infinite;
        }
        @keyframes vanosSolarRotate {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </svg>
  );
}

export function VanOSThermometer({
  temperature = 20,
  size = 24,
}: {
  temperature?: number | null;
  size?: number;
}) {
  const t = temperature ?? 20;
  const pct = Math.max(8, Math.min(92, 50 + (t - 20) * 3));

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-label={`Temperature ${t} degrees`}
      role="img"
    >
      <rect x="9" y="3" width="6" height="13" rx="3"
        fill="none" stroke="#9aa8b6" strokeWidth="1.6" />
      <circle cx="12" cy="18" r="4"
        fill="#0d131a" stroke="#9aa8b6" strokeWidth="1.6" />
      <rect
        x="11"
        y={18 - (13 * pct) / 100}
        width="2"
        height={(13 * pct) / 100}
        rx="1"
        fill="#3b9cff"
        style={{ transition: "y 240ms ease, height 240ms ease" }}
      />
      <circle cx="12" cy="18" r="2.4" fill="#3b9cff" />
      <path d="M17.5 7h2M17.5 10h1.4M17.5 13h2"
        stroke="#647382" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

export function VanOSWeather({
  condition = "partly cloudy",
  size = 30,
}: {
  condition?: string | null;
  size?: number;
}) {
  const c = (condition || "").toLowerCase();
  const rain = /rain|drizzle|shower/.test(c);
  const cloudy = /cloud|overcast/.test(c);
  const sunny = !cloudy || /sun|clear/.test(c);

  return (
    <svg
      className="vanos-animated"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-label={condition || "Weather"}
      role="img"
    >
      <style>{reducedMotion}</style>

      {sunny && (
        <g className="weather-sun">
          <circle cx="19" cy="18" r="7" fill="#f5c451" />
          <g stroke="#f5c451" strokeWidth="1.7" strokeLinecap="round">
            <path d="M19 5v4" />
            <path d="M19 27v4" />
            <path d="M6 18h4" />
            <path d="M28 18h4" />
            <path d="m10 9 3 3" />
            <path d="m25 24 3 3" />
            <path d="m28 9-3 3" />
            <path d="m13 24-3 3" />
          </g>
        </g>
      )}

      {cloudy && (
        <g className="weather-cloud" fill="#9aa8b6">
          <path d="M12 32h24c3.7 0 6-2.3 6-5.3 0-3.2-2.7-5.5-6-5.5-.8-5-4.8-8.2-9.6-8.2-4.5 0-8.2 2.8-9.4 6.9-.5-.1-1-.1-1.5-.1-3.5 0-6.2 2.5-6.2 6 0 3.4 2.7 6.2 6.7 6.2Z" />
        </g>
      )}

      {rain && (
        <g className="weather-rain" stroke="#3b9cff" strokeWidth="2"
           strokeLinecap="round">
          <path d="M16 36l-2 5" />
          <path d="M24 36l-2 5" />
          <path d="M32 36l-2 5" />
        </g>
      )}

      <style>{`
        .weather-sun {
          transform-origin: 19px 18px;
          animation: vanosWeatherSun 14s linear infinite;
        }
        .weather-cloud {
          animation: vanosCloudDrift 4s ease-in-out infinite alternate;
        }
        .weather-rain {
          animation: vanosRain 1.2s ease-in-out infinite;
        }
        @keyframes vanosWeatherSun {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes vanosCloudDrift {
          from { transform: translateX(0); }
          to { transform: translateX(2px); }
        }
        @keyframes vanosRain {
          0%,100% { opacity: .35; transform: translateY(-1px); }
          50% { opacity: 1; transform: translateY(2px); }
        }
      `}</style>
    </svg>
  );
}

/* Optional ready-made CSS class for the same restrained VanOS interaction language. */
export const vanosGraphicCss = `
@media (prefers-reduced-motion: reduce) {
  .vanos-animated, .vanos-animated * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
`;
