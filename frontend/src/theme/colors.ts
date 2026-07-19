/**
 * Color values for contexts that need a raw hex/rgba string rather than
 * a Tailwind class - inline SVG strokes, dynamically-generated
 * box-shadow glows, etc. Tailwind utility classes should reference the
 * named tokens directly (e.g. `text-battery`, `bg-solar/12`) instead of
 * these constants wherever a class will do.
 *
 * These values MUST match frontend/tailwind.config.js. There are two
 * copies only because Tailwind's config is evaluated by the build
 * tooling (Node/ESM) while this file is evaluated by the app itself at
 * runtime - keep them in sync by hand when either changes.
 */
export const colors = {
  battery: "#00c2a8",
  solar: "#ffb000",
  alert: "#ff4b55",
  success: "#37d67a",
  surfaceCard: "#151a21",
  base: "#0b0e12",
} as const;
