import { api } from '@/lib/api';
import { getServerThemes, onServerThemesChanged } from '@/lib/serverThemes';
import { useCockpitTheme } from '@/lib/useCockpitTheme';
import { useEffect, useState } from 'react';

/**
 * Resolves a theme's packaged imagery to URLs.
 *
 * A theme package can carry images and name them by ROLE:
 *
 *   "assets": { "hero": "assets/hero.jpg", "camera": "assets/camera.jpg" }
 *
 * A cockpit asks for a role and gets back either a URL served from the
 * Pi, or the built-in fallback. It never asks for an arbitrary path.
 *
 * Backward compatibility: early VanOS theme packages could contain
 * widget artwork files without listing every widget role in the
 * "assets" map. For the bounded widget artwork roles below, an omitted
 * role falls back to the package's conventional filename. This lets
 * those already-installed packages use the artwork they already contain;
 * explicit role mappings always win.
 *
 * Images are served by the backend with a Content-Type from an
 * allow-list and used here as a CSS background or an <img> src only -
 * never inlined - so an SVG in a theme cannot execute anything.
 */

const CONVENTIONAL_ROLE_ASSETS: Record<string, string> = {
  battery: 'assets/battery.jpg',
  solar: 'assets/solar.jpg',
  weather: 'assets/weather.jpg',
  'power-flow': 'assets/power-flow.jpg',
  heater: 'assets/heater.jpg',
  roof: 'assets/roof.jpg',
  switches: 'assets/switches.jpg',
};

export function useThemeAssets(): {
  asset: (role: string, fallback: string) => string;
  /** false when the theme wants its own hero imagery instead of the
   *  live camera. The camera then lives in its own Home tile. */
  heroCamera: boolean;
} {
  const { themeId } = useCockpitTheme();
  const [, tick] = useState(0);

  // The server theme list arrives asynchronously; re-render when it
  // does so imagery appears rather than waiting for a navigation.
  useEffect(() => onServerThemesChanged(() => tick((n) => n + 1)), []);

  const theme = themeId.startsWith('custom:')
    ? getServerThemes().find((t) => t.id === themeId)
    : undefined;

  return {
    asset: (role: string, fallback: string): string => {
      if (!theme?.serverId) return fallback;

      const path = theme.assets?.[role] ?? CONVENTIONAL_ROLE_ASSETS[role];
      if (!path) return fallback;

      return api.themeAssetUrl(theme.serverId, path);
    },
    heroCamera: theme?.heroCamera ?? true,
  };
}
