import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { isDemo } from '@/lib/demo';

// Only refetch the (cached) POI list once the van has actually moved a
// meaningful distance — a parked van re-running geolocation every few
// minutes shouldn't tear down and rebuild every map marker for a 0 m move.
const POI_REFRESH_MIN_MOVE_M = 250;

function metresBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const p1 = (aLat * Math.PI) / 180;
  const p2 = (bLat * Math.PI) / 180;
  const dp = ((bLat - aLat) * Math.PI) / 180;
  const dl = ((bLon - aLon) * Math.PI) / 180;
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// How often to quietly refresh position while the app is open. A few
// minutes is plenty for a parked/slow-moving van and is easy on battery;
// it also gives a future "trip log / breadcrumb" feature a steady stream
// of points to record without hammering the GPS.
const UPDATE_INTERVAL_MS = 3 * 60 * 1000;

/**
 * useAutoLocate — silently keeps the van's location set from *this device's*
 * GPS: once on load, then every few minutes while the app is open, with no
 * button press. After you've granted location permission once, every later
 * visit quietly refreshes the position and the whole app (weather, nearby,
 * solar outlook) follows.
 *
 * Deliberately quiet and conservative:
 *   - Only on a **secure origin**. Browsers disable geolocation entirely on
 *     http, so on the Pi's http://<ip> (e.g. the in-van tablet) this no-ops
 *     and the manual / IP options in Settings take over instead.
 *   - **Never prompts on its own** where we can tell: if the Permissions API
 *     reports geolocation isn't already 'granted', we leave it alone. On
 *     browsers without that API (older iOS Safari) we do attempt a fetch,
 *     which is silent when permission was previously granted and only shows
 *     the OS prompt the very first time — which is how you grant it.
 *   - Failures are swallowed silently: Settings has the visible controls and
 *     error messages; a background refresh shouldn't nag.
 */
export function useAutoLocate() {
  const qc = useQueryClient();
  // Last position we told the backend about, to gate POI refetches on
  // real movement.
  const lastPos = useRef<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    if (isDemo) return;
    if (typeof window === 'undefined' || !window.isSecureContext || !navigator.geolocation) return;

    let timer: number | undefined;
    let onVisible: (() => void) | undefined;

    const push = () => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            const { latitude, longitude } = pos.coords;
            await api.setLocation(latitude, longitude);
            qc.invalidateQueries({ queryKey: ['location'] });
            // Only refresh POIs when we've actually moved far enough to
            // change what's nearby. (The old ['weather'] invalidation was
            // a no-op — weather is WS-only, there's no such query.)
            const prev = lastPos.current;
            if (!prev || metresBetween(prev.lat, prev.lon, latitude, longitude) >= POI_REFRESH_MIN_MOVE_M) {
              qc.invalidateQueries({ queryKey: ['poi-nearby'] });
            }
            lastPos.current = { lat: latitude, lon: longitude };
          } catch {
            /* backend unreachable — not worth interrupting anyone over */
          }
        },
        () => {
          /* denied / unavailable — stay silent, the Settings card is the visible path */
        },
        // maximumAge < interval so each tick gets a reasonably fresh fix
        // rather than replaying a stale one; fine for a trip breadcrumb.
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
      );
    };

    const start = () => {
      push(); // immediately on load
      timer = window.setInterval(push, UPDATE_INTERVAL_MS);

      // The interval above pauses/throttles heavily while the tab or PWA
      // is backgrounded (mobile browsers do this aggressively to save
      // battery) — so reopening the app after a while showed a stale
      // position until the next tick eventually landed, which is exactly
      // what "the map doesn't update, I have to keep saving my location"
      // looks like from the outside. Same class of bug as the roof
      // watchdog: an interval alone isn't enough, you also need to catch
      // "we're back" and act immediately rather than wait for the clock.
      // Only wired up here (inside start(), which only runs once
      // permission is already confirmed granted) so this can't itself
      // trigger an unsolicited prompt just from switching tabs.
      onVisible = () => { if (document.visibilityState === 'visible') push(); };
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('focus', onVisible);
    };

    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'geolocation' as PermissionName })
        .then((status) => { if (status.state === 'granted') start(); })
        .catch(() => start()); // query unsupported for geolocation → attempt (silent if already granted)
    } else {
      start(); // no Permissions API (older Safari) → attempt; silent once granted
    }

    return () => {
      if (timer !== undefined) window.clearInterval(timer);
      if (onVisible) {
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener('focus', onVisible);
      }
    };
  }, [qc]);
}
