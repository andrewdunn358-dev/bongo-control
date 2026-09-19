import { api } from '@/lib/api';
import { getServerThemes, onServerThemesChanged } from '@/lib/serverThemes';
import { useCockpitTheme } from '@/lib/useCockpitTheme';
import { createAssetProbe, probeDeclaredAssets, resolveThemeAsset } from '@/lib/themeAssetResolve';
import { useEffect, useState } from 'react';

/**
 * Resolves a theme's packaged imagery to URLs.
 *
 * A theme package can carry images and name them by ROLE:
 *
 *   "assets": { "hero": "assets/hero.jpg", "battery": "assets/battery.jpg" }
 *
 * A cockpit asks for a role and gets back either a URL served from the
 * Pi, or the built-in fallback. It never asks for an arbitrary path.
 *
 * A packaged image is used only when the theme DECLARES it for that role
 * and it has been confirmed to EXIST - see themeAssetResolve.ts. There
 * is no conventional-filename fallback: a guessed path such as
 * assets/battery.jpg suppressed the built-in illustrated graphics on
 * every installed theme, whether or not the package contained the file.
 *
 * Images are served by the backend with a Content-Type from an
 * allow-list and used here as a CSS background or an <img> src only -
 * never inlined - so an SVG in a theme cannot execute anything.
 */

/** Loads an image to find out whether it is really there. Shared by
 *  every widget on the page, so each asset is fetched once. The browser
 *  caches the response, so the image the widget then shows costs no
 *  second download. */
const probe = createAssetProbe(
  (url) =>
    new Promise<boolean>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    }),
);

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
  // Likewise when an asset check comes back.
  useEffect(() => probe.subscribe(() => tick((n) => n + 1)), []);

  const theme = themeId.startsWith('custom:')
    ? getServerThemes().find((t) => t.id === themeId)
    : undefined;

  // Check every asset the theme declares, and nothing it does not. Until
  // an answer arrives the role shows its built-in drawing; a confirmed
  // image then replaces it.
  const serverId = theme?.serverId;
  const declared = theme?.assets;
  useEffect(() => {
    probeDeclaredAssets({ serverId, assets: declared }, api.themeAssetUrl, probe);
  }, [serverId, declared]);

  return {
    asset: (role: string, fallback: string): string =>
      resolveThemeAsset(theme, role, api.themeAssetUrl, probe.status) ?? fallback,
    heroCamera: theme?.heroCamera ?? true,
  };
}
