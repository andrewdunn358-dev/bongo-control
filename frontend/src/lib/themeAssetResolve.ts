/**
 * THEME ASSET RESOLUTION - which packaged image, if any, a role gets.
 *
 * A packaged image is used for a role ONLY when both hold:
 *
 *   1. the theme DECLARES it - its "assets" map names a path for that
 *      role; and
 *   2. the image EXISTS - it has actually been fetched from the Pi.
 *
 * Otherwise the answer is "no packaged asset", and the caller shows its
 * own built-in drawing or photo.
 *
 * WHY BOTH. A previous version fell back to a conventional filename
 * (battery -> assets/battery.jpg) when a role was not declared, and
 * returned that URL without knowing whether the file was in the
 * package. A filename is not evidence of a file. A packaged image
 * replaces a widget's drawing (layout/graphicChoice.ts), so every
 * installed theme lost its illustrated SVGs to a guessed path - either
 * the package's own picture, or a 404.
 *
 * Declaration alone is not enough either: the Pi validates that every
 * file in a package is an allowed type, but not that each path in the
 * "assets" map points at a file that is there. So existence is checked
 * here, by loading the image, rather than assumed.
 *
 * Pure apart from the injected loader, so it can be tested without a
 * browser.
 */

export interface AssetTheme {
  /** Present only for themes stored on the Pi. */
  serverId?: string;
  /** Role -> path inside the package, exactly as the theme declared it. */
  assets?: Record<string, string>;
}

/** The path a theme explicitly declares for a role, or undefined. Never
 *  invents one: an undeclared role has no packaged asset. */
export function declaredAssetPath(theme: AssetTheme | undefined, role: string): string | undefined {
  const path = theme?.assets?.[role];
  return typeof path === 'string' && path.trim() !== '' ? path : undefined;
}

/** Starts an existence check for every asset the theme declares - and
 *  nothing it does not, so no request is ever made for a guessed path. */
export function probeDeclaredAssets(
  theme: AssetTheme | undefined,
  urlFor: (serverId: string, path: string) => string,
  probe: Pick<AssetProbe, 'request'>,
): void {
  if (!theme?.serverId || !theme.assets) return;
  for (const role of Object.keys(theme.assets)) {
    const path = declaredAssetPath(theme, role);
    if (path) probe.request(urlFor(theme.serverId, path));
  }
}

export type AssetStatus = 'present' | 'missing' | 'unknown';

/**
 * The URL to use for a role, or undefined when the theme has no packaged
 * asset for it. `statusOf` reports whether that URL has been confirmed
 * to exist; an unconfirmed URL is treated as absent, so a built-in
 * drawing is shown rather than a request that may 404.
 */
export function resolveThemeAsset(
  theme: AssetTheme | undefined,
  role: string,
  urlFor: (serverId: string, path: string) => string,
  statusOf: (url: string) => AssetStatus,
): string | undefined {
  if (!theme?.serverId) return undefined;
  const path = declaredAssetPath(theme, role);
  if (!path) return undefined;
  const url = urlFor(theme.serverId, path);
  return statusOf(url) === 'present' ? url : undefined;
}

/**
 * Remembers which asset URLs exist. Each URL is loaded at most once per
 * page; subscribers hear when an answer arrives so the page can swap a
 * built-in drawing for the packaged image as soon as it is confirmed.
 */
export interface AssetProbe {
  status(url: string): AssetStatus;
  /** Starts a check if this URL has not been checked yet. Idempotent. */
  request(url: string): void;
  subscribe(fn: () => void): () => void;
}

export function createAssetProbe(load: (url: string) => Promise<boolean>): AssetProbe {
  const known = new Map<string, 'present' | 'missing'>();
  const inFlight = new Set<string>();
  const listeners = new Set<() => void>();

  return {
    status: (url) => known.get(url) ?? 'unknown',
    request(url) {
      if (known.has(url) || inFlight.has(url)) return;
      inFlight.add(url);
      load(url)
        .then((ok) => ok, () => false)
        .then((ok) => {
          inFlight.delete(url);
          known.set(url, ok ? 'present' : 'missing');
          listeners.forEach((fn) => fn());
        });
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
