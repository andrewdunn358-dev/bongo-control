/**
 * Minimal Google Maps JS API loader.
 *
 * Deliberately no npm wrapper package (@googlemaps/js-api-loader etc.) —
 * this is a single <script> tag with a callback, which is exactly what
 * Google's own docs recommend, and it's one less dependency to keep
 * updated. Memoized per API key so Trips and Nearby mounting/unmounting
 * independently share one script load rather than re-injecting the tag.
 */

let loadPromise: Promise<typeof google> | null = null;
let loadedForKey: string | null = null;

declare global {
  interface Window {
    __vanosGmapsReady__?: () => void;
  }
}

export function loadGoogleMaps(apiKey: string): Promise<typeof google> {
  if (loadPromise && loadedForKey === apiKey) return loadPromise;

  loadedForKey = apiKey;
  loadPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('No window - not a browser environment'));
      return;
    }
    if (window.google?.maps) {
      resolve(window.google);
      return;
    }

    window.__vanosGmapsReady__ = () => resolve(window.google);

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&callback=__vanosGmapsReady__&loading=async`;
    script.async = true;
    script.onerror = () => reject(new Error('Failed to load Google Maps - check the API key and its referrer restrictions'));
    document.head.appendChild(script);
  });

  return loadPromise;
}
