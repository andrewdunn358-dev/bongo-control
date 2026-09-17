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
 * Pi, or the built-in fallback. It never asks for a path, so a theme
 * cannot point a cockpit at something arbitrary, and a theme that omits
 * an image simply keeps the default rather than rendering an empty box.
 *
 * Images are served by the backend with a Content-Type from an
 * allow-list and used here as a CSS background or an <img> src only -
 * never inlined - so an SVG in a theme cannot execute anything.
 */
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
      const path = theme?.assets?.[role];
      if (!theme?.serverId || !path) return fallback;
      return api.themeAssetUrl(theme.serverId, path);
    },
    heroCamera: theme?.heroCamera ?? true,
  };
}
