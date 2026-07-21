import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const THEME_KEY = 'bongo.theme';
const ThemeCtx = createContext({ theme: 'dark', setTheme: () => {}, toggle: () => {} });

export const ThemeProvider = ({ children }) => {
  const [theme, setThemeState] = useState(() => {
    try {
      return localStorage.getItem(THEME_KEY) || 'dark';
    } catch (_) {
      return 'dark';
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'light');
    root.classList.add(theme);
    root.setAttribute('data-theme', theme);
    document.body.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (_) {
      /* ignore */
    }
  }, [theme]);

  const setTheme = useCallback((t) => setThemeState(t === 'light' ? 'light' : 'dark'), []);
  const toggle = useCallback(() => setThemeState((t) => (t === 'dark' ? 'light' : 'dark')), []);

  const value = useMemo(() => ({ theme, setTheme, toggle }), [theme, setTheme, toggle]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
};

export const useTheme = () => useContext(ThemeCtx);

// Small helper for feature code that just wants to read the persisted value.
export const readStoredValue = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
};

export const writeStoredValue = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {
    /* ignore */
  }
};
