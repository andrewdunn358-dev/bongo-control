import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_COCKPIT_THEME, getCockpitTheme } from '@/lib/cockpitThemes';
import type { CockpitTheme, CockpitThemeId } from '@/lib/cockpitThemes';

const STORAGE_KEY = 'vanos-cockpit-theme';

function read(): CockpitThemeId {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? DEFAULT_COCKPIT_THEME;
  } catch {
    // Private mode / storage disabled - fall back to the default rather
    // than throwing on first render.
    return DEFAULT_COCKPIT_THEME;
  }
}

/** Cross-component sync. Without this, changing the theme in Settings
 *  would not switch the cockpit until a reload: the `storage` event
 *  only fires in OTHER tabs, never the one that made the change. Same
 *  reasoning as useNavigationStyle. */
const listeners = new Set<(id: CockpitThemeId) => void>();

export function useCockpitTheme(): {
  /** The stored id. May not correspond to a real theme if one was
   *  removed in an update - use `theme` to render. */
  themeId: CockpitThemeId;
  /** Always a valid theme; falls back to the default if the stored id
   *  is unknown, so a removed theme can never leave a blank cockpit. */
  theme: CockpitTheme;
  setTheme: (id: CockpitThemeId) => void;
} {
  const [themeId, setThemeIdState] = useState<CockpitThemeId>(read);

  // Apply the theme to <html> so its token overrides in index.css reach
  // EVERY screen, not just the Home cockpit. Power, Weather, History and
  // the rest never reference a theme - they use --surface and --ink via
  // Tailwind, so they restyle automatically. This is what makes the
  // theme switch change the whole app.
  useEffect(() => {
    document.documentElement.setAttribute('data-cockpit-theme', getCockpitTheme(themeId).id);
  }, [themeId]);

  useEffect(() => {
    const onLocal = (id: CockpitThemeId) => setThemeIdState(id);
    listeners.add(onLocal);

    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setThemeIdState(read());
    };
    window.addEventListener('storage', onStorage);

    return () => {
      listeners.delete(onLocal);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const setTheme = useCallback((id: CockpitThemeId) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Preference just won't survive a reload; still apply it now.
    }
    listeners.forEach((fn) => fn(id));
  }, []);

  return { themeId, theme: getCockpitTheme(themeId), setTheme };
}
