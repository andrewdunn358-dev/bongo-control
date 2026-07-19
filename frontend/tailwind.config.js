/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Deep navy-charcoal, not pure black — Tesla/EcoFlow instrument-panel feel.
        // Updated from #0a0e14 during the V3 luminous redesign - slightly
        // cooler/deeper, increases separation from surface.raised.
        base: "#0b0e12",
        surface: {
          DEFAULT: "#0b0e12",
          raised: "#10151d",
          card: "#151a21",
          cardHover: "#1b222e",
        },
        border: {
          hairline: "rgba(255,255,255,0.07)",
        },
        text: {
          primary: "#edeff3",
          secondary: "#8a93a6",
          muted: "#5b6472",
        },
        // Domain accents tied to meaning, not decoration:
        solar: {
          DEFAULT: "#ffb000", // sunlight / production
          dim: "#7a5a2c",
        },
        battery: {
          DEFAULT: "#00c2a8", // electric / storage
          dim: "#2b6e68",
        },
        alert: {
          DEFAULT: "#ff4b55",
        },
        // Status green — distinct from battery teal. Used for "charging" /
        // "ready" / "good" states, never for section identity, so it never
        // competes with battery's domain color.
        success: {
          DEFAULT: "#37d67a",
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
