/**
 * An animated heater, drawn in SVG, that shows at a glance what the
 * unit is doing - the same job the picture does in the Hcalory app.
 *
 * Three readable states, distinct enough to tell apart from across the
 * van:
 *   off       - dark housing, fan still, burner unlit
 *   blowing   - fan spins, burner unlit
 *   heating   - fan spins, burner glows and pulses
 * Igniting shows the burner flickering rather than steady, and
 * cooldown keeps the fan spinning with the glow fading.
 *
 * Animation is CSS, and it honours prefers-reduced-motion: with that
 * set, the states are still told apart by colour and the glow, just
 * without the spinning. A permanently spinning element is a real
 * problem for some people and the colour carries the same information.
 *
 * An original drawing, not the app's image.
 */

type Props = {
  mode: 'off' | 'blowing' | 'igniting' | 'heating' | 'cooldown' | 'fault';
  size?: number;
};

export function HeaterGraphic({ mode, size = 220 }: Props) {
  const fanSpins = mode === 'blowing' || mode === 'igniting' || mode === 'heating' || mode === 'cooldown';
  const glow = mode === 'heating' || mode === 'igniting' || mode === 'cooldown';
  const fault = mode === 'fault';

  const glowOpacity = mode === 'heating' ? 1 : mode === 'igniting' ? 0.7 : mode === 'cooldown' ? 0.35 : 0;

  return (
    <svg viewBox="0 0 220 110" width={size} height={size / 2} role="img"
      aria-label={`Heater ${mode}`} style={{ display: 'block', margin: '0 auto', overflow: 'visible' }}>
      <style>{`
        @keyframes hg-spin { to { transform: rotate(360deg); } }
        @keyframes hg-pulse { 0%,100% { opacity: .75; } 50% { opacity: 1; } }
        @keyframes hg-flicker { 0%,100% { opacity: .55; } 30% { opacity: .95; } 60% { opacity: .5; } 80% { opacity: .9; } }
        /* transform-box: fill-box makes 50% 50% the centre of the fan's
           own bounding box, whatever coordinate space the browser applies
           the transform in. Without it the origin was being taken in a
           different space and the fan swung around an off-centre pivot
           instead of spinning on its hub. */
        .hg-fan { transform-box: fill-box; transform-origin: 50% 50%; }
        .hg-fan.spin { animation: hg-spin 1.1s linear infinite; }
        .hg-fan.spin.fast { animation-duration: .6s; }
        .hg-glow.heating { animation: hg-pulse 2.2s ease-in-out infinite; }
        .hg-glow.igniting { animation: hg-flicker 1.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .hg-fan.spin, .hg-glow.heating, .hg-glow.igniting { animation: none; }
        }
      `}</style>

      <defs>
        <radialGradient id="hg-burner" cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor="#FFE08A" />
          <stop offset="45%" stopColor="#FF8A2A" />
          <stop offset="100%" stopColor="#B83A0A" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="hg-body" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#3A414C" />
          <stop offset="100%" stopColor="#1C2129" />
        </linearGradient>
      </defs>

      {/* Housing */}
      <rect x="22" y="28" width="176" height="54" rx="10" fill="url(#hg-body)"
        stroke={fault ? '#F08080' : 'rgba(238,241,240,.18)'} strokeWidth="1.5" />

      {/* Burner window - the cut-away where the flame lives */}
      <rect x="92" y="38" width="60" height="34" rx="6" fill="#0B0E12" stroke="rgba(238,241,240,.10)" />
      <ellipse className={`hg-glow ${mode}`} cx="122" cy="55" rx="34" ry="19"
        fill="url(#hg-burner)" opacity={glowOpacity}
        style={{ transition: 'opacity .8s ease' }} />

      {/* Fan housing at the intake end */}
      <circle cx="40" cy="55" r="19" fill="#12161C" stroke="rgba(238,241,240,.16)" strokeWidth="1.5" />
      <g className={`hg-fan ${fanSpins ? 'spin' : ''} ${mode === 'heating' ? 'fast' : ''}`}
        fill={fanSpins ? '#5BC8E8' : '#3E4752'} style={{ transition: 'fill .5s ease' }}>
        <path d="M40 55 L40 40 A15 15 0 0 1 52 47 Z" />
        <path d="M40 55 L52 63 A15 15 0 0 1 40 70 Z" />
        <path d="M40 55 L28 63 A15 15 0 0 1 28 47 Z" />
        <circle cx="40" cy="55" r="4" />
      </g>

      {/* Outlet duct */}
      <rect x="196" y="42" width="18" height="26" rx="4" fill="#12161C" stroke="rgba(238,241,240,.16)" strokeWidth="1.5" />

      {/* Heat leaving the outlet, only when heating */}
      {mode === 'heating' && (
        <g stroke="#FF8A2A" strokeWidth="2" strokeLinecap="round" fill="none" opacity=".7">
          <path d="M218 48 q4 4 0 8" />
          <path d="M218 58 q4 4 0 8" />
        </g>
      )}

      {/* Feet */}
      <rect x="54" y="82" width="10" height="8" rx="2" fill="#12161C" />
      <rect x="156" y="82" width="10" height="8" rx="2" fill="#12161C" />
    </svg>
  );
}
