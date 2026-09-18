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
/** When --fit has reached its floor and the cockpit STILL does not fit,
 *  shrinking further is the wrong answer - it is the signal to change
 *  the composition instead. The hook then raises data-fit-step, and the
 *  cockpit's own CSS decides what that means for its layout: which
 *  block collapses, which row goes compact, what stops being drawn.
 *
 *  The hook deliberately knows NOTHING about either cockpit. It answers
 *  "how much space is there, and is it enough?"; the cockpit answers
 *  "given that, how should I arrange myself?". That split is what keeps
 *  this ONE mechanism rather than two, and it is why width is not
 *  handled here at all - column counts are container queries in each
 *  cockpit's CSS, responding to the box the cockpit actually got.
 *  Width drives structure, height drives this, and they never touch. */
const MAX_STEPS = 2;

export function useAutoFit<T extends HTMLElement>(enabled = true) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!enabled) {
      // Clear rather than merely stop. Fitting can be turned off by a
      // change of layout mode, and whatever the last pass wrote is
      // inline on the element - so returning early would leave a
      // rotated-to-portrait page wearing the squeezed values it had in
      // landscape, with nothing left running to undo them.
      el.style.removeProperty('--fit');
      el.removeAttribute('data-fit-step');
      return;
    }

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

      // Every pass starts from a clean slate and re-derives both values.
      // That determinism is what stops the ladder ratcheting: a window
      // that grows gets its composition back, because the step is
      // recomputed from scratch rather than only ever climbing.
      let fit = 1;
      node.style.setProperty('--fit', '1');
      node.removeAttribute('data-fit-step');

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

      // Scaling is spent. Anything still overflowing is a composition
      // problem, so step the ladder - one rung at a time, re-measuring
      // between, so a cockpit only ever sheds as much as it must.
      if (fit === MIN_FIT) {
        for (let step = 1; step <= MAX_STEPS; step++) {
          void node.offsetHeight;
          if (node.scrollHeight <= available) break;
          node.setAttribute('data-fit-step', String(step));
        }
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
    // Re-measure once everything has actually settled. The first pass
    // runs before images decode and before web fonts swap in, so the
    // cockpit measures TALLER than it will finally be - and with the
    // ladder in play that is not a cosmetic error: it made both
    // cockpits take a second rung they did not need, needlessly
    // dropping the satellite sky and the quote at 1143x628. Measured,
    // then fixed. Both are cheap, fire once, and are no-ops if the page
    // was already settled.
    window.addEventListener('load', schedule);
    document.fonts?.ready.then(schedule).catch(() => {});

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      window.removeEventListener('load', schedule);
    };
  }, [enabled]);

  return ref;
}
