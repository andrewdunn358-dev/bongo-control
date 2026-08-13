/**
 * Deep-links out to popular campervan spot-finding sites.
 *
 * Bongo owns its own POI data (OpenStreetMap via the backend PoiService),
 * but the big crowd-sourced directories — Park4Night's reviews, Pitchup's
 * bookable pitches — are worth a one-tap jump to cross-reference a spot.
 * None of them offers a usable public read API (Park4Night's is
 * unofficial and discouraged by its makers; Pitchup's is a
 * channel-manager push for campsite owners, not a data feed), so linking
 * out is the right integration: no scraping, no terms-of-service grey
 * area, and on a phone the OS opens the user's installed app if they
 * have one.
 *
 * Park4Night's web map honours `?lat=&lng=` (verified against the live
 * site — the params survive its language switch links), so we can centre
 * it on an exact point. Pitchup's search is path-based with no coordinate
 * parameter, so the honest best is its "near me" page, which geolocates
 * in the browser rather than taking the point we pass. `centres` records
 * that difference so the UI can be truthful about it.
 */

export interface SpotProvider {
  key: string;
  label: string;
  /** Full description of what tapping does, for tooltip / aria. */
  blurb: string;
  /** Build the outbound URL. Receives the point to centre on; a provider
   *  that can't take coordinates simply ignores it. */
  href: (lat: number, lng: number) => string;
  /** True when the resulting page genuinely centres on the passed point.
   *  False = it opens the provider but falls back to its own geolocation. */
  centres: boolean;
}

/** Park4Night web map centred on a point. */
export function park4nightUrl(lat: number, lng: number): string {
  return `https://park4night.com/en/search?lat=${lat}&lng=${lng}`;
}

/** Pitchup "campsites near me" — geolocates in the browser; no coord param. */
export function pitchupNearMeUrl(): string {
  return 'https://www.pitchup.com/campsites/near-me/';
}

/**
 * Providers offered as "jump out to cross-reference this spot" links.
 * Ordered most-useful-first for a UK campervanner: Park4Night (free
 * wild-camping / aire reviews, centres exactly) then Pitchup (bookable
 * sites, near-me).
 */
export const SPOT_PROVIDERS: SpotProvider[] = [
  {
    key: 'park4night',
    label: 'Park4Night',
    blurb: 'Crowd-sourced spots & reviews, centred on this location',
    href: park4nightUrl,
    centres: true,
  },
  {
    key: 'pitchup',
    label: 'Pitchup',
    blurb: 'Bookable campsites near you (uses your device location)',
    href: () => pitchupNearMeUrl(),
    centres: false,
  },
];
