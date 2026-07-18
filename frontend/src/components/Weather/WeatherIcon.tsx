import { useReducedMotion } from "framer-motion";

/**
 * Animated weather conditions, MagicMirror-style: pure SVG + CSS
 * keyframes rather than an animation library, so it costs almost
 * nothing to run continuously on a Raspberry Pi. Driven by the WMO
 * weather code the Open-Meteo API returns.
 *
 * Respects prefers-reduced-motion by rendering the same scene static.
 */

export type WeatherScene = "clear" | "partly" | "cloudy" | "rain" | "snow" | "fog" | "storm";

export function sceneFromCode(code: number | null): WeatherScene {
  if (code === null) return "cloudy";
  if (code === 0 || code === 1) return "clear";
  if (code === 2) return "partly";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 95) return "storm";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  return "cloudy";
}

const SOLAR = "#f0a84e";
const CLOUD = "#8a93a6";
const RAIN = "#4a9eea";
const SNOW = "#dbe4ee";

function Sun({ x = 50, y = 42, r = 16, spin }: { x?: number; y?: number; r?: number; spin: boolean }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill={SOLAR} opacity={0.95} />
      <g style={spin ? { transformOrigin: `${x}px ${y}px`, animation: "wx-spin 24s linear infinite" } : undefined}>
        {Array.from({ length: 8 }).map((_, i) => {
          const angle = (i * Math.PI) / 4;
          const inner = r + 6;
          const outer = r + 13;
          return (
            <line
              key={i}
              x1={x + Math.cos(angle) * inner}
              y1={y + Math.sin(angle) * inner}
              x2={x + Math.cos(angle) * outer}
              y2={y + Math.sin(angle) * outer}
              stroke={SOLAR}
              strokeWidth={3}
              strokeLinecap="round"
              opacity={0.8}
            />
          );
        })}
      </g>
    </g>
  );
}

function Cloud({ x, y, scale = 1, fill = CLOUD, opacity = 1, drift }: { x: number; y: number; scale?: number; fill?: string; opacity?: number; drift?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} opacity={opacity} style={drift ? { animation: drift } : undefined}>
      <ellipse cx={0} cy={0} rx={26} ry={15} fill={fill} />
      <ellipse cx={-18} cy={5} rx={16} ry={11} fill={fill} />
      <ellipse cx={18} cy={5} rx={17} ry={11} fill={fill} />
    </g>
  );
}

function Drops({ animate, color = RAIN }: { animate: boolean; color?: string }) {
  const drops = [
    { x: 34, delay: 0 },
    { x: 46, delay: 0.35 },
    { x: 58, delay: 0.7 },
    { x: 70, delay: 0.2 },
    { x: 82, delay: 0.55 },
  ];
  return (
    <g>
      {drops.map((d, i) => (
        <line
          key={i}
          x1={d.x}
          y1={72}
          x2={d.x - 3}
          y2={82}
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
          opacity={animate ? 0 : 0.7}
          style={animate ? { animation: `wx-fall 1.1s linear ${d.delay}s infinite` } : undefined}
        />
      ))}
    </g>
  );
}

function Flakes({ animate }: { animate: boolean }) {
  const flakes = [
    { x: 36, delay: 0 },
    { x: 50, delay: 0.8 },
    { x: 64, delay: 1.6 },
    { x: 78, delay: 0.4 },
  ];
  return (
    <g>
      {flakes.map((f, i) => (
        <circle
          key={i}
          cx={f.x}
          cy={74}
          r={3}
          fill={SNOW}
          opacity={animate ? 0 : 0.8}
          style={animate ? { animation: `wx-drift-down 3s linear ${f.delay}s infinite` } : undefined}
        />
      ))}
    </g>
  );
}

export default function WeatherIcon({ scene, size = 160 }: { scene: WeatherScene; size?: number }) {
  const reduce = useReducedMotion();
  const animate = !reduce;

  return (
    <>
      <style>{`
        @keyframes wx-spin { to { transform: rotate(360deg); } }
        @keyframes wx-fall {
          0%   { transform: translateY(-6px); opacity: 0; }
          25%  { opacity: 0.75; }
          100% { transform: translateY(16px); opacity: 0; }
        }
        @keyframes wx-drift-down {
          0%   { transform: translate(0, -6px); opacity: 0; }
          20%  { opacity: 0.85; }
          100% { transform: translate(6px, 18px); opacity: 0; }
        }
        @keyframes wx-drift {
          0%, 100% { transform: translateX(0); }
          50%      { transform: translateX(7px); }
        }
        @keyframes wx-drift-slow {
          0%, 100% { transform: translateX(0); }
          50%      { transform: translateX(-6px); }
        }
        @keyframes wx-flash {
          0%, 92%, 100% { opacity: 0; }
          94%, 97%      { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
      `}</style>
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
        {scene === "clear" && <Sun spin={animate} y={50} r={20} />}

        {scene === "partly" && (
          <>
            <Sun x={38} y={38} r={14} spin={animate} />
            <Cloud x={60} y={58} scale={0.85} drift={animate ? "wx-drift 7s ease-in-out infinite" : undefined} />
          </>
        )}

        {scene === "cloudy" && (
          <>
            <Cloud x={44} y={44} scale={0.75} opacity={0.5} drift={animate ? "wx-drift-slow 11s ease-in-out infinite" : undefined} />
            <Cloud x={54} y={58} scale={0.95} drift={animate ? "wx-drift 8s ease-in-out infinite" : undefined} />
          </>
        )}

        {scene === "rain" && (
          <>
            <Cloud x={54} y={52} scale={0.95} drift={animate ? "wx-drift 8s ease-in-out infinite" : undefined} />
            <Drops animate={animate} />
          </>
        )}

        {scene === "snow" && (
          <>
            <Cloud x={54} y={52} scale={0.95} drift={animate ? "wx-drift 9s ease-in-out infinite" : undefined} />
            <Flakes animate={animate} />
          </>
        )}

        {scene === "storm" && (
          <>
            <Cloud x={54} y={50} scale={0.95} fill="#6b7484" />
            <polygon
              points="52,64 46,80 53,80 48,94 64,74 55,74 61,64"
              fill={SOLAR}
              opacity={animate ? 0 : 0.9}
              style={animate ? { animation: "wx-flash 3.5s linear infinite" } : undefined}
            />
            <Drops animate={animate} />
          </>
        )}

        {scene === "fog" && (
          <>
            <Cloud x={52} y={42} scale={0.8} opacity={0.35} />
            {[58, 68, 78].map((y, i) => (
              <line
                key={y}
                x1={24}
                y1={y}
                x2={78}
                y2={y}
                stroke={CLOUD}
                strokeWidth={5}
                strokeLinecap="round"
                opacity={0.5}
                style={animate ? { animation: `wx-drift ${6 + i * 2}s ease-in-out ${i * 0.5}s infinite` } : undefined}
              />
            ))}
          </>
        )}
      </svg>
    </>
  );
}
