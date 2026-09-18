import { useCallback, useEffect, useState } from 'react';

export type NavigationStyle = 'dock' | 'sidebar';

const STORAGE_KEY = 'vanos-navigation-style';
/** Below this the sidebar is never used, whatever the preference says -
 *  a phone gets the bottom dock. Deliberately NOT the same constant as
 *  Home's useIsWideScreen(900): navigation style and which Home layout
 *  renders are separate concerns and should be free to diverge. */
const SIDEBAR_MIN_WIDTH = 900;

function read(): NavigationStyle {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'dock' ? 'dock' : 'sidebar';
  } catch {
    // Private mode / storage disabled - fall back to the default
    // rather than throwing on first render.
    return 'sidebar';
  }
}

/** Cross-component sync. Without this, changing the setting in Settings
 *  would not move the nav until a reload: the `storage` event only fires
 *  in OTHER tabs, never the one that made the change. */
const listeners = new Set<(s: NavigationStyle) => void>();

export function useNavigationStyle() {
  const [style, setStyleState] = useState<NavigationStyle>(read);
  // A phone in LANDSCAPE takes the rail, not the dock. The dock is a
  // bottom bar, so it costs HEIGHT - 57px of bar plus 80px of clearance
  // on the page - and height is the one thing a 730x325 viewport has
  // none of. The rail costs width instead, which landscape has to
  // spare. Measured: with the dock's clearance gone the cockpit fits
  // 730x325 with 26px left over; with it, it overflows by 48px.
  const railOk = () =>
    typeof window !== 'undefined' &&
    (window.innerWidth >= SIDEBAR_MIN_WIDTH || window.matchMedia('(max-height: 500px)').matches);
  const [wideEnough, setWideEnough] = useState(railOk);

  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${SIDEBAR_MIN_WIDTH}px)`);
    const short = window.matchMedia('(max-height: 500px)');
    const onResize = () => setWideEnough(railOk());
    setWideEnough(railOk());
    mql.addEventListener('change', onResize);
    short.addEventListener('change', onResize);

    const onLocal = (s: NavigationStyle) => setStyleState(s);
    listeners.add(onLocal);
    // Other tabs.
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setStyleState(read());
    };
    window.addEventListener('storage', onStorage);

    return () => {
      mql.removeEventListener('change', onResize);
      short.removeEventListener('change', onResize);
      listeners.delete(onLocal);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const setStyle = useCallback((next: NavigationStyle) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Preference just won't survive a reload; still apply it now.
    }
    listeners.forEach((fn) => fn(next));
  }, []);

  return {
    /** What the user chose. Survives a narrow viewport so returning to a
     *  tablet restores their choice rather than silently resetting it. */
    style,
    setStyle,
    /** What should actually render right now. */
    effectiveStyle: (wideEnough ? style : 'dock') as NavigationStyle,
  };
}
