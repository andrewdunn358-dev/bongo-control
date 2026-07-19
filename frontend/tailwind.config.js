/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Every color below resolves through a CSS variable (defined in
        // index.css) rather than a literal hex value - that's what lets
        // Light/Dark/System mode work by just swapping which variable
        // set is active, without touching any component file.
        //
        // The rgb(var(--x) / <alpha-value>) wrapper (not a plain CSS
        // variable reference) is required, not stylistic: Tailwind's
        // opacity modifiers (bg-battery/15, border-solar/25, etc, used
        // 20+ times across this codebase) only work when the color is
        // expressed as an RGB triplet Tailwind can inject an alpha
        // channel into - a bare `var(--color-x)` holding a hex string
        // would silently break every one of those.
        base: "rgb(var(--color-base) / <alpha-value>)",
        surface: {
          DEFAULT: "rgb(var(--color-base) / <alpha-value>)",
          raised: "rgb(var(--color-surface-raised) / <alpha-value>)",
          card: "rgb(var(--color-surface-card) / <alpha-value>)",
          cardHover: "rgb(var(--color-surface-card-hover) / <alpha-value>)",
        },
        border: {
          hairline: "rgb(var(--color-hairline) / 0.07)",
        },
        text: {
          primary: "rgb(var(--color-text-primary) / <alpha-value>)",
          secondary: "rgb(var(--color-text-secondary) / <alpha-value>)",
          muted: "rgb(var(--color-text-muted) / <alpha-value>)",
        },
        // Domain accents tied to meaning, not decoration - kept the
        // same values across both themes (brand consistency, same
        // approach many products take), rather than a fully separate
        // light-mode accent palette.
        solar: {
          DEFAULT: "rgb(var(--color-solar) / <alpha-value>)",
          dim: "rgb(var(--color-solar-dim) / <alpha-value>)",
        },
        battery: {
          DEFAULT: "rgb(var(--color-battery) / <alpha-value>)",
          dim: "rgb(var(--color-battery-dim) / <alpha-value>)",
        },
        alert: {
          DEFAULT: "rgb(var(--color-alert) / <alpha-value>)",
        },
        success: {
          DEFAULT: "rgb(var(--color-success) / <alpha-value>)",
        },
      },
      fontFamily: {
        display: ["Sora", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "ui-monospace", "monospace"],
      },
      borderRadius: {
        xl2: "1.5rem",
      },
      boxShadow: {
        card: "0 1px 0 0 rgba(255,255,255,0.05) inset, 0 12px 32px -12px rgba(0,0,0,0.55)",
      },
    },
  },
  plugins: [],
};
