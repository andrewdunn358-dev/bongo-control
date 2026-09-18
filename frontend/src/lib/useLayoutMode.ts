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
 *   landscape  height < 500, WHATEVER the width. A phone on its side -
 *              real ones report about 1080x450, not the 730x325 this
 *              was first built against - and equally a short desktop
 *              window, which wants the same treatment.
 *   wide       height >= 500 and width >= 900. Tablet and desktop.
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
  // HEIGHT IS TESTED FIRST, deliberately. Checking width first sent a
  // phone in landscape down the 'wide' path whenever it reported 900px
  // or more across - and a real phone does: measured 1080x450 on the
  // device, not the 730x325 this was built against. It then got the
  // full tablet composition (562px of cockpit) on a 389px content area.
  // The constraint that matters is height; width only decides which
  // SHORT layout applies.
  if (window.matchMedia(SHORT).matches) return 'landscape';
  return window.matchMedia(WIDE).matches ? 'wide' : 'portrait';
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
