import { useEffect, useState } from 'react';

/**
 * True when the viewport is tablet/desktop-sized rather than a phone.
 * Used to switch Home between the phone-first layout and the fuller
 * CockpitDashboard - "when a tablet or desktop connects, show the
 * complete dashboard" (Andrew, 14 Sep).
 *
 * matchMedia + a change listener, not a resize listener + innerWidth
 * poll - fires only when the breakpoint is actually crossed, not on
 * every pixel of a drag-resize.
 */
export function useIsWideScreen(minWidthPx = 900): boolean {
  const [isWide, setIsWide] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(`(min-width: ${minWidthPx}px)`).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${minWidthPx}px)`);
    const onChange = (e: MediaQueryListEvent) => setIsWide(e.matches);
    setIsWide(mql.matches); // the breakpoint prop can change between renders; re-sync rather than trust stale state
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [minWidthPx]);

  return isWide;
}
