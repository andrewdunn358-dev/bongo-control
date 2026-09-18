import { Suspense } from 'react';
import { InstrumentCockpit } from '@/components/cockpits/InstrumentCockpit';
import { useCockpitTheme } from '@/lib/useCockpitTheme';
import { useLayoutMode } from '@/lib/useLayoutMode';

export function Home() {
  // Three compositions, not two. A phone in landscape used to be handed
  // the portrait layout because the old check was width-only - 730x325
  // and 363x737 look identical to a 900px width test. They are not the
  // same problem, so they no longer share an answer.
  //
  // Both 'wide' and 'landscape' render the SELECTED COCKPIT: a phone on
  // its side has the shape of a cockpit, not of a scrolling column, and
  // the theme architecture should not be something you lose by turning
  // the device. The cockpit's own sizing (useAutoFit's --fit, then the
  // composition ladder) does the fitting; it is enabled for landscape
  // in the cockpit stylesheets.
  //
  // Portrait keeps today's mobile composition unchanged, deliberately.
  // It works, and it is not themed on purpose - a narrow column has
  // different constraints and is not something themes should fragment.
  const mode = useLayoutMode();
  return mode === 'portrait' ? <InstrumentCockpit /> : <ThemedCockpit />;
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
