import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

type ThemeName = 'dark' | 'light';

interface ThemeCtx {
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx>({ theme: 'dark', setTheme: () => {}, toggle: () => {} });
const KEY = 'bongo.theme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(() => {
    try { return (localStorage.getItem(KEY) as ThemeName | null) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'light');
    root.classList.add(theme);
    try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
    // Update <meta name="theme-color"> so the browser chrome matches
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
    if (meta) meta.content = theme === 'light' ? '#eef2f7' : '#0a1628';
  }, [theme]);

  const setTheme = useCallback((t: ThemeName) => setThemeState(t), []);
  const toggle = useCallback(() => setThemeState((t) => (t === 'dark' ? 'light' : 'dark')), []);
  const value = useMemo(() => ({ theme, setTheme, toggle }), [theme, setTheme, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);

/**
 * Recharts styles axes via inline JS props, not CSS classes, so it cannot
 * inherit CSS variables. Resolve theme-aware colours here for chart use.
 */
export function useChartColors() {
  const { theme } = useTheme();
  return useMemo(() => {
    if (theme === 'light') {
      return {
        axis: '#475569',
        grid: 'rgba(15,41,66,0.10)',
        tooltipBg: 'rgba(255,255,255,0.95)',
        tooltipBorder: 'rgba(34,211,238,0.4)',
        tooltipColor: '#0a1628',
      };
    }
    return {
      axis: '#94a3b8',
      grid: 'rgba(148,163,184,0.10)',
      tooltipBg: 'rgba(15,41,66,0.92)',
      tooltipBorder: 'rgba(34,211,238,0.3)',
      tooltipColor: '#e6f0ff',
    };
  }, [theme]);
}

/** Small key/value helpers — used for map centre + POI filter persistence. */
export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}
export function writeStored<T>(key: string, value: T) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}
