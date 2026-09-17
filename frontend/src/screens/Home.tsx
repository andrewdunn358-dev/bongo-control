import { Suspense } from 'react';
import { InstrumentCockpit } from '@/components/cockpits/InstrumentCockpit';
import { useCockpitTheme } from '@/lib/useCockpitTheme';
import { useIsWideScreen } from '@/lib/useIsWideScreen';

export function Home() {
  // "When a tablet or desktop connects, show the complete dashboard"
  // (Andrew, 14 Sep) - same route, same data, just a different
  // component once the viewport is tablet/desktop-sized rather than a
  // phone. Delegates to two separate components rather than an early
  // return inside one, so neither path can skip the other's hooks on a
  // render where isWide flips (React's Rules of Hooks).
  const isWide = useIsWideScreen(900);

  // Mobile is deliberately NOT themed - a phone layout has different
  // constraints and is not something themes should fragment. Below the
  // breakpoint it is always the Instrument cockpit, whatever theme is
  // selected.
  //
  // It renders the SAME component the Instrument theme renders, not a
  // separate phone copy: that component's lg: breakpoints already give
  // a single-column stack below the grid breakpoint. Keeping one copy
  // is the point - when this layout existed twice the two drifted, and
  // the wide one was quietly replaced by a different design entirely
  // (see the note at the top of InstrumentCockpit.tsx).
  return isWide ? <ThemedCockpit /> : <InstrumentCockpit />;
}

/** Renders the selected cockpit theme. Themes are lazy-loaded, so only
 *  the chosen one's code and CSS are fetched - adding themes does not
 *  grow the initial bundle. */
function ThemedCockpit() {
  const { theme } = useCockpitTheme();
  const Cockpit = theme.component;
  return (
    <Suspense fallback={<div className="h-64" aria-busy="true" />}>
      <Cockpit />
    </Suspense>
  );
}
