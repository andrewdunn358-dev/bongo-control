import { useEffect, useState } from 'react';

/**
 * WHICH COMPOSITION THE APP SHOULD BE IN.
 *
 * Replaces useIsWideScreen, which was width-only with a 900px
 * breakpoint - so a phone in portrait (363x737) and the same phone in
 * landscape (730x325) were treated as the same layout. They are not the
 * same problem: one has 737px of height and a narrow column, the other
 * has 325px and a wide one.
 *
 *   wide       width >= 900. Tablet and desktop. Unchanged behaviour.
 *   landscape  width < 900 AND height < 500. A phone on its side.
 *   portrait   everything else. A phone upright.
 *
 * HEIGHT is what separates the two phone cases; width alone cannot see
 * the difference, which is exactly why the old hook could not.
 *
 * matchMedia rather than a resize listener: it fires when a boundary is
 * actually crossed, not on every pixel of a drag, and it reports
 * correctly on a real orientation change without a reload.
 *
 * The mode is also written to <html data-layout>, because the cockpit
 * stylesheets need the same answer and should not each re-derive it.
 */
export type LayoutMode = 'portrait' | 'landscape' | 'wide';

const WIDE = '(min-width: 900px)';
const SHORT = '(max-height: 500px)';

function read(): LayoutMode {
  if (typeof window === 'undefined') return 'wide';
  if (window.matchMedia(WIDE).matches) return 'wide';
  return window.matchMedia(SHORT).matches ? 'landscape' : 'portrait';
}

export function useLayoutMode(): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>(read);

  useEffect(() => {
    const wide = window.matchMedia(WIDE);
    const short = window.matchMedia(SHORT);
    const sync = () => {
      const next = read();
      setMode(next);
      document.documentElement.dataset.layout = next;
    };
    sync();
    wide.addEventListener('change', sync);
    short.addEventListener('change', sync);
    return () => {
      wide.removeEventListener('change', sync);
      short.removeEventListener('change', sync);
    };
  }, []);

  return mode;
}
