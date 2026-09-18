import { useAutoFit } from '@/lib/useAutoFit';
import { useLayoutMode } from '@/lib/useLayoutMode';
import { LayoutRenderer } from '@/layout/LayoutRenderer';
import { ADVENTURE_HOME } from '@/layout/layouts';
import './adventure.css';

/**
 * ADVENTURE.
 *
 * There is no Adventure-specific composition left. Every piece of this
 * page - hero, the four telemetry cards, the four action tiles, the
 * footer - is a registered widget, and their arrangement is the layout
 * data in ADVENTURE_HOME. Swap that list for another and this same
 * component renders a different Home with no new markup and no new CSS.
 *
 * What remains here is the two jobs the renderer needs a host for, and
 * neither is composition:
 *   - the measured SURFACE, via useAutoFit, which publishes --fit and
 *     the ladder step the widgets and the grid respond to;
 *   - the PRESENTATION STATE, decided here today and by the fit engine
 *     once it takes the job over.
 *
 * When the layout comes from a .vanos-theme package instead of from
 * code, nothing in this file changes.
 */
export function AdventureCockpit() {
  const fitRef = useAutoFit<HTMLDivElement>();
  const widgetState = useLayoutMode() === 'landscape' ? 'compact' : 'full';
  return (
    <div className="vm-page" ref={fitRef}>
      <LayoutRenderer layout={ADVENTURE_HOME} state={widgetState} />
    </div>
  );
}
