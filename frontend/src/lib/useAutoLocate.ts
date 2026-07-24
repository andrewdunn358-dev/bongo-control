import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { isDemo } from '@/lib/demo';

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

  useEffect(() => {
    if (isDemo) return;
    if (typeof window === 'undefined' || !window.isSecureContext || !navigator.geolocation) return;

    let timer: number | undefined;

    const push = () => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            await api.setLocation(pos.coords.latitude, pos.coords.longitude);
            qc.invalidateQueries({ queryKey: ['location'] });
            qc.invalidateQueries({ queryKey: ['weather'] });
            qc.invalidateQueries({ queryKey: ['poi-nearby'] });
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
    };

    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'geolocation' as PermissionName })
        .then((status) => { if (status.state === 'granted') start(); })
        .catch(() => start()); // query unsupported for geolocation → attempt (silent if already granted)
    } else {
      start(); // no Permissions API (older Safari) → attempt; silent once granted
    }

    return () => { if (timer !== undefined) window.clearInterval(timer); };
  }, [qc]);
}
