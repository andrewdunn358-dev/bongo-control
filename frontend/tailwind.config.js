/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      // NOTE: placeholder palette only. Replace once the design system
      // from the UI/UX design sprint (docs/design-system.md) is finalized.
      colors: {
        surface: {
          DEFAULT: "#0b0f14",
          raised: "#141a21",
          card: "#181f27",
        },
        accent: {
          DEFAULT: "#3ddc97",
        },
      },
    },
  },
  plugins: [],
};
