import { api } from '@/lib/api';
import type { ServerTheme } from '@/lib/api';
import type { CustomTheme } from '@/lib/customThemes';

/**
 * Themes installed on the Pi.
 *
 * The first implementation kept imported themes in each browser's
 * localStorage, which meant a theme imported on the desktop did not
 * exist on the mounted tablet. That defeated the entire point of a
 * portable package - you could share a theme with a stranger but not
 * with your own tablet. They now live on the Pi and every device sees
 * the same set.
 *
 * SELECTION stays per-device, deliberately: the tablet may want a
 * bright theme in daylight while a phone stays dark at night.
 *
 * Cached in a module-level variable because useCockpitTheme needs a
 * theme synchronously on first paint to avoid a flash of the wrong
 * colours. The cache is primed once at startup and refreshed after any
 * install or delete.
 */

let cache: CustomTheme[] = [];
const listeners = new Set<(t: CustomTheme[]) => void>();

function toCustomTheme(s: ServerTheme): CustomTheme {
  return {
    id: `custom:${s.id}`,
    name: s.name,
    author: s.author ?? undefined,
    description: s.description ?? undefined,
    tokens: s.tokens,
    formatVersion: (s.formatVersion === 1 ? 1 : 0) as 0 | 1,
    typography: (s.typography ?? undefined) as CustomTheme['typography'],
    shape: (s.shape ?? undefined) as CustomTheme['shape'],
    density: (s.density ?? undefined) as CustomTheme['density'],
    assets: s.assets ?? undefined,
    previewPath: s.preview ?? undefined,
    /** Bare id, needed to build asset URLs against the Pi. */
    serverId: s.id,
  } as CustomTheme;
}

export function getServerThemes(): CustomTheme[] {
  return cache;
}

export async function refreshServerThemes(): Promise<CustomTheme[]> {
  try {
    const { themes } = await api.themes();
    cache = themes.map(toCustomTheme);
  } catch {
    // Offline, or the backend predates this route. Leaving the cache
    // alone is better than blanking the user's themes because one
    // request failed.
  }
  listeners.forEach((fn) => fn(cache));
  return cache;
}

export function onServerThemesChanged(fn: (t: CustomTheme[]) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
