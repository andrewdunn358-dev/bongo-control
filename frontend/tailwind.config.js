/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Deep navy-charcoal, not pure black — Tesla/EcoFlow instrument-panel feel.
        base: "#0a0e14",
        surface: {
          DEFAULT: "#0a0e14",
          raised: "#10151d",
          card: "#161c26",
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
        // Two accents tied to meaning, not decoration:
        solar: {
          DEFAULT: "#f0a84e", // sunlight / production
          dim: "#7a5a2c",
        },
        battery: {
          DEFAULT: "#46d2c4", // electric / storage
          dim: "#2b6e68",
        },
        alert: {
          DEFAULT: "#ff6b6a",
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
