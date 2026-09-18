import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_COCKPIT_THEME, getCockpitTheme } from '@/lib/cockpitThemes';
import { applyCustomTheme, loadCustomThemes } from '@/lib/customThemes';
import { getServerThemes, refreshServerThemes, onServerThemesChanged } from '@/lib/serverThemes';
import type { CockpitTheme, CockpitThemeId } from '@/lib/cockpitThemes';
import type { LayoutDefinition } from '@/layout/schema';

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
  /** The Home composition the active theme defines, if it defines one.
   *  Undefined means the cockpit renders its built-in composition. */
  homeLayout?: LayoutDefinition;
  /** Widget ids the theme asked for that this build does not have. */
  unknownWidgets?: string[];
} {
  const [themeId, setThemeIdState] = useState<CockpitThemeId>(read);

  // The server list arrives asynchronously, so a selected server theme
  // cannot be applied on the very first paint. Re-running when it lands
  // is what makes it appear, rather than the app looking unthemed until
  // the next navigation.
  const [serverTick, setServerTick] = useState(0);
  useEffect(() => {
    void refreshServerThemes();
    return onServerThemesChanged(() => setServerTick((n) => n + 1));
  }, []);


  // Apply the theme to <html> so its token overrides in index.css reach
  // EVERY screen, not just the Home cockpit. Power, Weather, History and
  // the rest never reference a theme - they use --surface and --ink via
  // Tailwind, so they restyle automatically. This is what makes the
  // theme switch change the whole app.
  useEffect(() => {
    // A custom theme layers ITS TOKENS on top of a built-in theme's
    // layout. It never replaces the cockpit component - a data file
    // cannot supply one - so the base attribute is still set, and the
    // custom tokens are applied as inline properties on <html>, which
    // win over the stylesheet by specificity.
    // Server themes first, then legacy browser-local ones. Local
    // themes from before themes moved to the Pi keep working rather
    // than silently disappearing.
    const custom = themeId.startsWith('custom:')
      ? getServerThemes().find((t) => t.id === themeId)
        ?? loadCustomThemes().find((t) => t.id === themeId)
        ?? null
      : null;

    const base = custom ? getCockpitTheme(custom.cockpit ?? DEFAULT_COCKPIT_THEME).id : getCockpitTheme(themeId).id;
    document.documentElement.setAttribute('data-cockpit-theme', base);
    applyCustomTheme(custom);
  }, [themeId, serverTick]);

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

  // A custom theme has no component of its own, so it renders the
  // default cockpit layout wearing its colours.
  // A custom theme renders the built-in cockpit it NAMES, falling back
  // to the default when it names none or names one this build does not
  // have. Previously every custom theme was forced into the default
  // cockpit, which is why a theme asking for Adventure's hero behaviour
  // never got it - it was not rendering Adventure at all.
  const custom = themeId.startsWith('custom:')
    ? getServerThemes().find((t) => t.id === themeId) ?? loadCustomThemes().find((t) => t.id === themeId)
    : undefined;
  const layoutId = themeId.startsWith('custom:')
    ? (custom?.cockpit ?? DEFAULT_COCKPIT_THEME)
    : themeId;
  const theme = getCockpitTheme(layoutId);
  // The Home composition the active theme defines, if any. Absent means
  // the cockpit renders its built-in composition, so every theme made
  // before layouts existed behaves exactly as it did.
  const activeCustom = themeId.startsWith('custom:')
    ? getServerThemes().find((t) => t.id === themeId) ?? loadCustomThemes().find((t) => t.id === themeId) ?? null
    : null;

  return {
    themeId,
    theme,
    setTheme,
    homeLayout: activeCustom?.homeLayout,
    unknownWidgets: activeCustom?.unknownWidgets,
  };
}
