/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk"', 'ui-sans-serif', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        // Bongo aurora / deep-navy palette
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
        // shadcn required tokens (mapped to dark navy)
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      backgroundImage: {
        'aurora-radial':
          'radial-gradient(60% 45% at 12% 12%, rgba(34,211,238,0.28) 0%, transparent 60%), radial-gradient(55% 45% at 88% 18%, rgba(168,85,247,0.22) 0%, transparent 60%), radial-gradient(65% 50% at 70% 90%, rgba(56,189,248,0.18) 0%, transparent 65%)',
        'grid-fade':
          'linear-gradient(rgba(148,163,184,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.06) 1px, transparent 1px)',
      },
      backgroundSize: {
        'grid-48': '48px 48px',
      },
      boxShadow: {
        'glow-teal': '0 0 24px rgba(34,211,238,0.35), inset 0 0 1px rgba(34,211,238,0.55)',
        'glow-purple': '0 0 24px rgba(168,85,247,0.35), inset 0 0 1px rgba(168,85,247,0.55)',
        'glass': '0 8px 32px rgba(2,8,20,0.55), inset 0 0 0 1px rgba(255,255,255,0.06)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'aurora-pulse': {
          '0%, 100%': { opacity: '0.55', transform: 'scale(1)' },
          '50%': { opacity: '0.9', transform: 'scale(1.03)' },
        },
        'live-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
        'shimmer': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'aurora-pulse': 'aurora-pulse 4.5s ease-in-out infinite',
        'live-pulse': 'live-pulse 1.4s ease-in-out infinite',
        'shimmer': 'shimmer 2.4s linear infinite',
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
