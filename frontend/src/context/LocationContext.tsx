import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { api } from "../services/api";

interface LocationState {
  latitude: number;
  longitude: number;
  source: string;
  updated_at: number;
  city?: string;
  country?: string;
}

interface LocationContextValue {
  location: LocationState | null;
  /** Loading state only for the very first fetch, not for background refreshes. */
  initialLoading: boolean;
  /**
   * Ensures the location is reasonably fresh before a caller uses it -
   * pages call this on mount instead of just reading whatever's
   * already stored. If the last reading is older than the staleness
   * threshold, attempts a real GPS fix and persists it centrally (so
   * Weather's background poll and everything else sharing this same
   * backend location also benefits, not just whichever page happened
   * to trigger the refresh).
   *
   * Deliberately getCurrentPosition (a single fresh fix), not
   * watchPosition (continuous tracking) - checking nearby campsites
   * needs an accurate snapshot when the page opens, not a live moving
   * dot while looking at a static list.
   *
   * Fails soft on purpose: if GPS is denied, times out, or the browser
   * doesn't support it, this quietly leaves whatever location was
   * already known in place rather than blocking the page or throwing -
   * a stale-but-present location is more useful than none at all.
   */
  ensureFresh: () => Promise<void>;
}

const STALE_AFTER_MS = 10 * 60 * 1000; // 10 minutes

const LocationContext = createContext<LocationContextValue>({
  location: null,
  initialLoading: true,
  ensureFresh: async () => {},
});

export function LocationProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<LocationState | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const hasLoadedOnce = useRef(false);
  // De-dupes concurrent calls - if Nearby and Weather both mount around
  // the same moment and both call ensureFresh(), only one actual GPS
  // request should fire rather than two competing permission prompts.
  const inFlightRef = useRef<Promise<void> | null>(null);

  const loadStored = useCallback(async (): Promise<LocationState | null> => {
    try {
      const stored = await api.location.get();
      setLocation(stored);
      return stored;
    } catch {
      return null;
    } finally {
      if (!hasLoadedOnce.current) {
        hasLoadedOnce.current = true;
        setInitialLoading(false);
      }
    }
  }, []);

  const requestFreshGps = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve();
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => {
          api.location
            .setGps(position.coords.latitude, position.coords.longitude)
            .then(() => loadStored())
            .catch(() => {
              // Persisting failed (e.g. backend briefly unreachable) -
              // fine, whatever was already loaded stays in place.
            })
            .finally(() => resolve());
        },
        () => {
          // Denied, timed out, or unavailable - fail soft, keep
          // whatever location is already known rather than erroring.
          resolve();
        },
        { timeout: 8000, maximumAge: 0 }
      );
    });
  }, [loadStored]);

  const ensureFresh = useCallback(async () => {
    if (inFlightRef.current) {
      await inFlightRef.current;
      return;
    }

    const run = async () => {
      const current = location ?? (await loadStored());
      const age = current ? Date.now() / 1000 - current.updated_at : Infinity;
      if (age < STALE_AFTER_MS / 1000) return; // already fresh enough
      await requestFreshGps();
    };

    const promise = run().finally(() => {
      inFlightRef.current = null;
    });
    inFlightRef.current = promise;
    await promise;
  }, [location, loadStored, requestFreshGps]);

  return (
    <LocationContext.Provider value={{ location, initialLoading, ensureFresh }}>{children}</LocationContext.Provider>
  );
}

export function useLocationContext() {
  return useContext(LocationContext);
}
