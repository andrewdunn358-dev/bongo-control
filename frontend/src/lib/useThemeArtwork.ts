import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getServerThemes, onServerThemesChanged } from '@/lib/serverThemes';
import { useCockpitTheme } from '@/lib/useCockpitTheme';
import { useThemePreview } from '@/lib/themePreview';
import { batteryArtwork, solarArtwork, weatherArtwork, type Artwork, type ArtworkChoice } from '@/lib/artwork';

/**
 * The installed theme's STATE-DRIVEN ARTWORK, ready for a widget to ask
 * "what should I show for this reading?".
 *
 * The theme states the mapping; lib/artwork.ts evaluates it; this hook
 * only supplies the theme and turns a path inside the package into a URL
 * the Pi serves. In the Theme Studio the draft's own images answer
 * instead, so a design is previewed with the same rules the van uses.
 *
 * Every function returns null when the theme says nothing for the
 * current reading - including when the reading itself is missing - and
 * the widget then draws VanOS's own graphic. Artwork never stands in
 * for a measurement.
 */
export function useThemeArtwork(): {
  battery: (reading: { soc: number | null | undefined; charging: boolean | undefined }) => ArtworkChoice;
  solar: (reading: { watts: number | null | undefined }) => ArtworkChoice;
  weather: (reading: { condition: string | null | undefined }) => ArtworkChoice;
} {
  const preview = useThemePreview();
  const { themeId } = useCockpitTheme();
  const [, tick] = useState(0);
  useEffect(() => onServerThemesChanged(() => tick((n) => n + 1)), []);

  const installed = themeId.startsWith('custom:')
    ? getServerThemes().find((t) => t.id === themeId)
    : undefined;

  const artwork: Artwork | undefined = preview ? preview.artwork : installed?.artwork;
  const serverId = installed?.serverId;

  // A path inside the package -> a URL. In the Studio the draft's images
  // are not on the Pi at all, so its own object URLs answer.
  const resolve = (path: string): string | undefined => {
    if (preview) return preview.artUrls?.[path];
    if (!serverId) return undefined;
    return api.themeAssetUrl(serverId, path);
  };

  // In the Studio, the author's chosen reading stands in for the van's,
  // so a frame can be seen at any level. Never outside it.
  const sim = preview?.simulate;
  const pick = <T,>(simulated: T | undefined, live: T): T => (simulated === undefined ? live : simulated);

  return {
    battery: (reading) =>
      batteryArtwork(
        artwork?.battery,
        { soc: pick(sim?.soc, reading.soc), charging: pick(sim?.charging, reading.charging) },
        resolve,
      ),
    solar: (reading) => solarArtwork(artwork?.solar, { watts: pick(sim?.watts, reading.watts) }, resolve),
    weather: (reading) => weatherArtwork(artwork?.weather, { condition: pick(sim?.condition, reading.condition) }, resolve),
  };
}
