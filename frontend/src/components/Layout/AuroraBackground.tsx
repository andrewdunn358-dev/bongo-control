import { useReducedMotion } from "framer-motion";

/**
 * Ambient aurora backdrop - slow drifting colour blobs behind a subtle
 * grid and noise overlay. Purely decorative; sits fixed behind all
 * content at z-index 0 with everything else above it.
 *
 * Implemented as CSS-animated blurred divs rather than canvas or SVG
 * filters, because this runs continuously on a Raspberry Pi 2 driving
 * a dashboard that may be left on for hours. Transform and opacity
 * animations are GPU-composited and cost essentially nothing; a canvas
 * loop or animated SVG filter would not be.
 *
 * Theme-aware via the same CSS variables as everything else, so the
 * blobs tint correctly in light mode instead of glowing through a
 * white page.
 */
export default function AuroraBackground() {
  const reduceMotion = useReducedMotion();

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {/* Base wash - keeps the very edges from reading as flat black */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(160deg, rgb(var(--color-base)) 0%, rgb(var(--color-base-deep)) 100%)",
        }}
      />

      {/* Teal blob - top left */}
      <div
        className={reduceMotion ? "" : "animate-aurora-drift-a"}
        style={{
          position: "absolute",
          top: "-18%",
          left: "-12%",
          width: "58vw",
          height: "58vw",
          maxWidth: "820px",
          maxHeight: "820px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgb(var(--color-battery) / 0.20), transparent 68%)",
          filter: "blur(70px)",
        }}
      />

      {/* Purple blob - right, slightly lower */}
      <div
        className={reduceMotion ? "" : "animate-aurora-drift-b"}
        style={{
          position: "absolute",
          top: "8%",
          right: "-16%",
          width: "52vw",
          height: "52vw",
          maxWidth: "760px",
          maxHeight: "760px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgb(var(--color-aurora-purple) / 0.18), transparent 68%)",
          filter: "blur(80px)",
        }}
      />

      {/* Blue blob - bottom, wide and shallow */}
      <div
        className={reduceMotion ? "" : "animate-aurora-drift-c"}
        style={{
          position: "absolute",
          bottom: "-24%",
          left: "18%",
          width: "64vw",
          height: "46vw",
          maxWidth: "900px",
          maxHeight: "620px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgb(var(--color-aurora-blue) / 0.14), transparent 70%)",
          filter: "blur(90px)",
        }}
      />

      {/* Grid - masked so it fades out toward the edges rather than
          stopping abruptly at the viewport border */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgb(var(--color-ink) / 0.028) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--color-ink) / 0.028) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(ellipse 90% 70% at 50% 40%, #000 40%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 90% 70% at 50% 40%, #000 40%, transparent 100%)",
        }}
      />

      {/* Noise - breaks up the banding that large blurred gradients
          produce on cheaper panels, which is exactly what a van dash
          display is likely to be. Inline SVG so there's no extra
          network request. */}
      <div
        className="absolute inset-0 opacity-[0.15] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")",
        }}
      />
    </div>
  );
}
