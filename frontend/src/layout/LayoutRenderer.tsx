import { getWidget } from '@/components/widgets/registry';
import type { WidgetState } from '@/components/widgets/types';
import { LAYOUT_COLUMNS, type LayoutDefinition } from './schema';
import './layout.css';

/**
 * THE GENERIC RENDERER.
 *
 * Turns a layout - which only says what goes where - into an actual
 * grid. Everything physical is decided here: the column count, how a
 * logical span becomes a real one, the gaps, and which presentation
 * state each widget is asked for. That is the half of the contract the
 * schema deliberately cannot reach.
 *
 *   layout  ->  what goes where
 *   renderer ->  how it is drawn, and how it gives way when space runs out
 *
 * A widget is never consulted about the viewport. It is handed a state
 * and a width and draws itself.
 */
export function LayoutRenderer({
  layout,
  state = 'full',
  className,
}: {
  layout: LayoutDefinition;
  /** Presentation state passed to every widget. The renderer decides
   *  this - today from the cockpit, later from the fit engine. */
  state?: WidgetState;
  className?: string;
}) {
  return (
    <div className={className ? `vl-grid ${className}` : 'vl-grid'} data-vl-state={state}>
      {layout.items.map((item, i) => {
        const def = getWidget(item.widget);
        // Unknown ids were already dropped by parseLayout; this is the
        // belt-and-braces path for a layout built by hand in code.
        if (!def) return null;
        const Widget = def.component;
        const span = Math.min(item.span ?? LAYOUT_COLUMNS, LAYOUT_COLUMNS);
        return (
          <div
            key={`${item.widget}-${i}`}
            className="vl-slot"
            // the slot carries its own span so the collapse rules can
            // widen a narrow item without ALSO narrowing a full-width
            // one - a span-12 hero stayed full width before the grid
            // existed and must keep doing so
            data-vl-span={span}
            style={{
              // The only thing the layout's numbers touch: which logical
              // columns this slot occupies. No widths, no pixels.
              gridColumn: item.column ? `${item.column} / span ${span}` : `span ${span}`,
            }}
          >
            <Widget state={state} />
          </div>
        );
      })}
    </div>
  );
}
