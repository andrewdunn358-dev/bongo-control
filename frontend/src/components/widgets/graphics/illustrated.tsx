import { useId } from 'react';
import type { BatteryGraphicProps, SolarGraphicProps, WeatherGraphicProps, PowerFlowGraphicProps } from './types';

const reduceMotion = `
@media (prefers-reduced-motion: reduce) {
  .vw-illustrated, .vw-illustrated * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
`;

export function IllustratedBattery({ soc, charging, size }: BatteryGraphicProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const known = soc != null;
  const value = known ? Math.max(0, Math.min(100, soc as number)) : 0;
  const fillHeight = 92 * value / 100;

  return (
    <svg className="vw-illustrated" width={size} height={Math.round(size * 1.12)} viewBox="0 0 180 202" role="img"
      aria-label={known ? `Battery ${Math.round(value)} percent` : 'Battery state unknown'}>
      <style>{reduceMotion}</style>
      <defs>
        <linearGradient id={`batFill-${uid}`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="var(--vw-role-charge-fill)" />
          <stop offset="1" stopColor="var(--vw-role-energy-path)" stopOpacity=".45" />
        </linearGradient>
        <clipPath id={`batClip-${uid}`}><rect x="36" y="45" width="108" height="116" rx="28" /></clipPath>
      </defs>
      <ellipse cx="90" cy="171" rx="65" ry="12" fill="var(--vw-role-energy-path)" opacity=".12" />
      <rect x="69" y="17" width="42" height="19" rx="7" fill="var(--vw-role-illustration)" opacity=".8" />
      <rect x="25" y="31" width="130" height="158" rx="34" fill="var(--vw-panel)" stroke="var(--vw-role-illustration)" strokeWidth="2.5" />
      <ellipse cx="90" cy="47" rx="54" ry="18" fill="var(--vw-panel2)" stroke="var(--vw-role-illustration-soft)" strokeWidth="2" />
      <ellipse cx="90" cy="48" rx="43" ry="11" fill="var(--vw-role-illustration)" opacity=".15" />
      {known && <rect x="36" y={161 - fillHeight} width="108" height={fillHeight} rx="20"
        fill={`url(#batFill-${uid})`} clipPath={`url(#batClip-${uid})`} />}
      <g clipPath={`url(#batClip-${uid})`} opacity=".32">
        <path d="M28 148 Q58 113 77 142 T126 130 T156 145 V180 H28Z" fill="var(--vw-role-illustration)" />
        <path d="M28 163 Q54 145 78 159 T125 153 T156 164 V184 H28Z" fill="var(--vw-role-energy-path)" />
        <path d="M46 165 l9-28 8 22 8-34 12 40 12-25 10 28 10-18 13 25" fill="none"
          stroke="var(--vw-role-illustration)" strokeWidth="3" />
      </g>
      {charging && known && <g className="vw-battery-energy">
        <path d="M90 116 l-12 19 h10 l-5 20 18-25 h-11z" fill="rgb(var(--status-amber))" />
        <ellipse cx="90" cy="76" rx="42" ry="7" fill="rgb(var(--status-amber))" opacity=".16" />
      </g>}
    </svg>
  );
}

export function IllustratedSolar({ size, active }: SolarGraphicProps) {
  return (
    <svg className="vw-illustrated" width={size} height={Math.round(size * .88)} viewBox="0 0 180 158" role="img" aria-label="Solar panel">
      <style>{reduceMotion}</style>
      <g transform="translate(12 24) rotate(-8 78 48)">
        <rect x="22" y="20" width="116" height="72" rx="5" fill="var(--vw-panel2)" stroke="var(--vw-role-illustration)" strokeWidth="2" />
        <g stroke="var(--vw-role-energy-path)" strokeOpacity=".5">
          <path d="M51 20v72M80 20v72M109 20v72M22 44h116M22 68h116" />
        </g>
        <rect x="28" y="26" width="104" height="60" rx="2" fill="var(--vw-role-energy-path)" opacity=".10" />
        <path d="M80 94v24M49 118h62" stroke="var(--vw-role-illustration)" strokeWidth="4" strokeLinecap="round" />
      </g>
      <g className={active ? 'vw-solar-active' : ''}>
        <circle cx="42" cy="34" r="16" fill="rgb(var(--status-amber))" opacity=".9" />
        <g stroke="rgb(var(--status-amber))" strokeWidth="3" strokeLinecap="round">
          <path d="M42 7v10M42 51v10M15 34h10M59 34h10M23 15l7 7M57 53l7 7M61 15l-7 7M23 53l7-7" />
        </g>
      </g>
      <path d="M8 137 Q35 112 57 132 T103 126 T172 137 V153 H8Z" fill="var(--vw-role-illustration)" opacity=".25" />
      <style>{`
        .vw-solar-active { transform-origin: 42px 34px; animation: vwSolarPulse 2s ease-in-out infinite; }
        @keyframes vwSolarPulse { 0%,100% { transform: scale(.94); opacity:.72; } 50% { transform: scale(1.08); opacity:1; } }
      `}</style>
    </svg>
  );
}

export function IllustratedWeather({ condition, size }: WeatherGraphicProps) {
  const c = (condition || '').toLowerCase();
  const rain = /rain|drizzle|shower/.test(c);
  const cloud = /cloud|overcast/.test(c);
  const clear = !cloud;
  return (
    <svg className="vw-illustrated" width={size} height={size} viewBox="0 0 150 150" role="img" aria-label={condition || 'Weather'}>
      <style>{reduceMotion}</style>
      {clear && <g className="vw-weather-sun"><circle cx="52" cy="48" r="24" fill="rgb(var(--status-amber))" />
        <g stroke="rgb(var(--status-amber))" strokeWidth="4" strokeLinecap="round">
          <path d="M52 10v15M52 71v15M14 48h15M75 48h15M25 21l11 11M68 64l11 11M79 21L68 32M36 64L25 75" />
        </g></g>}
      {cloud && <g>
        <path d="M28 84h86c13 0 22-9 22-21s-10-21-23-21c-4-17-17-27-35-27-17 0-31 11-36 27-2-.5-4-1-6-1-13 0-23 9-23 22s9 21 15 21Z"
          fill="var(--vw-role-illustration)" opacity=".82" />
        {rain && <g className="vw-weather-rain" stroke="var(--vw-role-energy-path)" strokeWidth="5" strokeLinecap="round">
          <path d="M48 96l-6 15M73 96l-6 15M98 96l-6 15" />
        </g>}
      </g>}
      <path d="M6 134 Q31 110 55 128 T101 123 T144 134 V149 H6Z" fill="var(--vw-role-illustration)" opacity=".25" />
      <style>{`
        .vw-weather-sun { transform-origin: 52px 48px; animation: vwWeatherSun 18s linear infinite; }
        .vw-weather-rain { animation: vwWeatherRain 1s ease-in-out infinite; }
        @keyframes vwWeatherSun { to { transform: rotate(360deg); } }
        @keyframes vwWeatherRain { 0%,100% { opacity:.35; transform:translateY(-2px); } 50% { opacity:1; transform:translateY(2px); } }
      `}</style>
    </svg>
  );
}

export function IllustratedPowerFlow({ solarWatts, loadWatts }: PowerFlowGraphicProps) {
  const incoming = Number(solarWatts || 0) > 0;
  const outgoing = Number(loadWatts || 0) > 0;
  return (
    <svg className="vw-illustrated vw-power-art" viewBox="0 0 420 170" role="img" aria-label="Solar to battery to systems power flow">
      <style>{reduceMotion}</style>
      <g className={incoming ? 'vw-flow-active' : ''}>
        <path d="M20 70 H135" stroke="rgb(var(--status-amber))" strokeWidth="3" strokeDasharray="8 8" opacity=".7" />
        <path d="M113 60 l18 10 -18 10" fill="none" stroke="rgb(var(--status-amber))" strokeWidth="4" />
        <circle cx="45" cy="70" r="18" fill="rgb(var(--status-amber))" opacity=".9" />
        <g stroke="rgb(var(--status-amber))" strokeWidth="3"><path d="M45 42v-10M45 108v-10M17 70H7M83 70H73" /></g>
      </g>
      <rect x="139" y="22" width="142" height="126" rx="38" fill="var(--vw-panel2)" stroke="var(--vw-role-illustration)" strokeWidth="3" />
      <path d="M169 92 Q210 48 251 92 L251 128 H169Z" fill="var(--vw-role-energy-path)" opacity=".18" />
      <path d="M185 61 h50 l-10 16 h10 l-25 30 6-22 h-12z" fill="var(--vw-role-energy-path)" opacity=".95" />
      <g className={outgoing ? 'vw-flow-active-out' : ''}>
        <path d="M285 100 H400" stroke="var(--vw-role-energy-path)" strokeWidth="3" strokeDasharray="8 8" opacity=".7" />
        <path d="M392 90 l18 10 -18 10" fill="none" stroke="var(--vw-role-energy-path)" strokeWidth="4" />
        <path d="M355 46 q18 18 0 36 q-18-18 0-36Z" fill="var(--vw-role-illustration)" opacity=".6" />
      </g>
      <style>{`
        .vw-flow-active, .vw-flow-active-out { animation: vwFlowDash 1.1s linear infinite; }
        .vw-flow-active-out { animation-duration: .8s; }
        @keyframes vwFlowDash { to { stroke-dashoffset: -32; } }
      `}</style>
    </svg>
  );
}
