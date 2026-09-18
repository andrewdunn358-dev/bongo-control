import { Suspense } from 'react';
import { useCockpitTheme } from '@/lib/useCockpitTheme';
import { ThemedHome, resolveComposition } from '@/layout/ThemedHome';

export function Home() {
  // ONE themed path. Home no longer picks a cockpit component, and it no
  // longer overrides the selection by orientation.
  //
  // PORTRAIT USED TO THROW THE THEME AWAY. It rendered Instrument
  // whatever was selected, on the reasoning that a phone has different
  // constraints and is not something themes should fragment. Measured
  // consequence: with Adventure selected at 363x737 the cockpit rendered
  // Instrument with zero renderer slots, so a package's composition was
  // silently discarded on a phone held upright. Orientation is a
  // SURFACE, not a different application - the renderer's collapse rules
  // reduce a 12-column composition to a single column, which is what a
  // tall narrow surface wants anyway.
  const { theme, homeLayout } = useCockpitTheme();
  const composition = resolveComposition(theme.id, homeLayout);

  // Instrument and Control are still hand-written components in this
  // build, so they have no composition to resolve. That branch is the
  // LEGACY path, and it is reached only when the selected theme brings no
  // composition of its own: a theme carrying one is drawn above, whatever
  // built-in it names. The branch disappears when they are migrated.
  if (composition) return <ThemedHome composition={composition} />;
  return <LegacyCockpit />;
}

/** A cockpit that has not been migrated to a composition yet. Lazy, so
 *  only the selected one's code and CSS are fetched. */
function LegacyCockpit() {
  const { theme } = useCockpitTheme();
  const Cockpit = theme.component;
  if (!Cockpit) return null;
  return (
    <Suspense fallback={<div className="h-64" aria-busy="true" />}>
      <Cockpit />
    </Suspense>
  );
}
