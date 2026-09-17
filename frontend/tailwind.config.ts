import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Fonts likewise. A theme picks from a SAFE BUILT-IN list only -
      // no remote font loading, so a theme cannot make the van's
      // dashboard depend on someone else's CDN being up.
      fontFamily: {
        sans: 'var(--font-sans)',
        display: 'var(--font-display)',
        mono: 'var(--font-mono)',
      },
      colors: {
        // Theme-aware ink (white in dark, near-black in light). Use these
        // instead of hardcoded text-white / text-black so opacity variants
        // (e.g. text-ink/70) work across both themes.
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          soft: 'rgb(var(--ink-soft) / <alpha-value>)',
          muted: 'rgb(var(--ink-muted) / <alpha-value>)',
          faint: 'rgb(var(--ink-faint) / <alpha-value>)',
        },
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          raised: 'rgb(var(--surface-raised) / <alpha-value>)',
          sunken: 'rgb(var(--surface-sunken) / <alpha-value>)',
        },
        line: 'rgb(var(--line) / <alpha-value>)',
        navy: {
          950: '#050b18',
          900: '#0a1628',
          800: '#0f2942',
          700: '#142f4d',
          600: '#1a3d66',
          500: '#264c7a',
        },
        aurora: {
          teal: 'rgb(var(--aurora-teal) / <alpha-value>)',
          blue: 'rgb(var(--aurora-blue) / <alpha-value>)',
          purple: 'rgb(var(--aurora-purple) / <alpha-value>)',
          pink: 'rgb(var(--aurora-pink) / <alpha-value>)',
          lime: 'rgb(var(--aurora-lime) / <alpha-value>)',
        },
        status: {
          green: 'rgb(var(--status-green) / <alpha-value>)',
          amber: 'rgb(var(--status-amber) / <alpha-value>)',
          red: 'rgb(var(--status-red) / <alpha-value>)',
        },
        brand: {
          orange: 'rgb(var(--brand-orange) / <alpha-value>)',
        },
      },
      // Radius resolves through CSS variables for the same reason the
      // colours do: a cockpit theme can then restyle every rounded-*
      // in the app (188 usages) without touching a single component.
      // Defaults in index.css preserve the current appearance exactly.
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
      },
      keyframes: {
        'aurora-pulse': {
          '0%, 100%': { opacity: '0.55', transform: 'scale(1)' },
          '50%': { opacity: '0.9', transform: 'scale(1.03)' },
        },
        'live-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'aurora-pulse': 'aurora-pulse 4.5s ease-in-out infinite',
        'live-pulse': 'live-pulse 1.4s ease-in-out infinite',
        'fade-in': 'fade-in 0.3s ease-out both',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
