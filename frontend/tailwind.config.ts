import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk"', 'ui-sans-serif', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
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
          teal: '#22d3ee',
          blue: '#38bdf8',
          purple: '#a855f7',
          pink: '#f472b6',
          lime: '#a3e635',
        },
        status: {
          green: '#10b981',
          amber: '#f59e0b',
          red: '#ef4444',
        },
      },
      borderRadius: {
        lg: '0.9rem',
        md: '0.7rem',
        sm: '0.5rem',
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
