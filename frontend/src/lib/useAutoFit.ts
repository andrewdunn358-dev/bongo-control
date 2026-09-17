import { useEffect, useRef } from 'react';

/**
 * AUTO-FIT
 *
 * Measures whether a cockpit actually fits the space it has been given,
 * and if not, scales its spacing down until it does.
 *
 * WHY THIS EXISTS: the previous approach was hand-written media-query
 * tiers whose values came from estimating how tall the cards would
 * render. That estimate was wrong repeatedly - a tier sized for a
 * viewport the device never reported, a camera min-height that was
 * never the thing setting the row height, card heights guessed
 * optimistically. Measuring removes the guess entirely: the browser
 * knows the real height, so ask it.
 *
 * HOW: the element is measured against its container. If it overflows,
 * --fit is lowered and the cockpit's CSS multiplies its gaps, padding
 * and headline sizes by it. Re-measured on resize, rotation and when
 * kiosk chrome appears or disappears.
 *
 * DELIBERATELY NOT transform: scale(). That is the tempting shortcut
 * and it is wrong here - it blurs text at non-integer scales, which
 * matters on a dashboard read at a glance while driving, and it breaks
 * position:fixed descendants. Scaling the VARIABLES keeps every glyph
 * crisply rendered at its real size.
 */

/** Never shrink past this. Below it the numbers stop being readable at
 *  a glance, and an unreadable dashboard that fits is worse than a
 *  readable one that scrolls. */
const MIN_FIT = 0.78;
/** Bounded passes. Shrinking changes content height, which changes the
 *  measurement - without a cap that can oscillate forever. */
const MAX_PASSES = 4;
const STEP = 0.06;

export function useAutoFit<T extends HTMLElement>(enabled = true) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    let frame = 0;
    let cancelled = false;
    // measure() writes --fit, which resizes the element, which fires the
    // ResizeObserver, which calls measure() again - and because measure
    // starts by resetting --fit to 1, it oscillated between fitted and
    // unfitted forever and often settled UNFITTED. This flag makes the
    // observer ignore resizes this hook caused itself.
    let applying = false;

    const measure = () => {
      if (cancelled || !ref.current) return;
      const node = ref.current;
      applying = true;

      // Space between the top of the cockpit and the bottom of the
      // viewport, less a small margin so the last card never sits flush
      // against the edge.
      const top = node.getBoundingClientRect().top;
      const available = window.innerHeight - top - 12;
      if (available <= 0) return;

      let fit = 1;
      node.style.setProperty('--fit', '1');

      for (let pass = 0; pass < MAX_PASSES; pass++) {
        // scrollHeight is the content's real height, including anything
        // overflowing - which is exactly the question being asked.
        if (node.scrollHeight <= available) break;
        fit = Math.max(MIN_FIT, fit - STEP);
        node.style.setProperty('--fit', String(fit));
        if (fit === MIN_FIT) break;
        // Force layout so the next pass measures the new value rather
        // than the stale one.
        void node.offsetHeight;
      }

      // Released on the next frame: the observer fires asynchronously
      // after layout, so clearing it synchronously here would still let
      // this pass's own resize through.
      requestAnimationFrame(() => { applying = false; });
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    schedule();

    // ResizeObserver catches content changes (a longer recommendation,
    // a camera image loading) that no resize event would report.
    const ro = new ResizeObserver(() => {
      if (applying) return;
      schedule();
    });
    ro.observe(el);
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
    };
  }, [enabled]);

  return ref;
}
