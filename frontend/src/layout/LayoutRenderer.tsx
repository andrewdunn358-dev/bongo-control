import { useCallback, useEffect, useRef, useState } from 'react';
import { getWidget } from '@/components/widgets/registry';
import { VARIANT_TABLES } from '@/components/widgets/graphics/registry';
import type { WidgetState } from '@/components/widgets/types';
import { LAYOUT_COLUMNS, type LayoutDefinition } from './schema';
import { resolveVariant, STANDARD } from './variantFit';
import './layout.css';

/**
 * THE GENERIC RENDERER.
 *
 * Turns a layout - which only says what goes where - into an actual
 * grid. Everything physical is decided here: the column count, how a
 * logical span becomes a real one, the gaps, which presentation state
 * each widget is asked for, and WHICH DRAWING each widget uses.
 *
 *   layout   ->  what goes where
 *   renderer ->  how it is drawn, and how it gives way when space runs out
 *
 * Variant resolution belongs here for the same reason placement does:
 * the renderer is the only thing that knows how big the slot actually
 * turned out to be. A widget is never consulted about the viewport; it
 * is handed a state, a width and a drawing.
 */
export function LayoutRenderer({
  layout,
  state = 'full',
  presentation,
  className,
}: {
  layout: LayoutDefinition;
  /** Presentation state passed to every widget. The renderer decides
   *  this - today from the cockpit, later from the fit engine. */
  state?: WidgetState;
  /** Per-widget drawing chosen by the theme, already validated. */
  presentation?: Record<string, { variant?: string }>;
  className?: string;
}) {
  // Measured slot boxes, keyed by slot index. A variant is only used
  // once its slot has been measured; until then the standard drawing
  // renders, which is correct rather than merely safe - an illustrated
  // graphic drawn into a box of unknown size is the failure being
  // avoided.
  const [boxes, setBoxes] = useState<Record<number, { width: number; height: number }>>({});
  const observer = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    observer.current = new ResizeObserver((entries) => {
      setBoxes((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const entry of entries) {
          const i = Number((entry.target as HTMLElement).dataset.vlIndex);
          if (Number.isNaN(i)) continue;
          const r = entry.contentRect;
          const w = Math.round(r.width);
          const h = Math.round(r.height);
          // Whole pixels only: sub-pixel churn would re-render on every
          // animation frame for no visible benefit.
          if (prev[i]?.width !== w || prev[i]?.height !== h) {
            next[i] = { width: w, height: h };
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    });
    return () => observer.current?.disconnect();
  }, []);

  const attach = useCallback((node: HTMLDivElement | null) => {
    if (node) observer.current?.observe(node);
  }, []);

  return (
    <div className={className ? `vl-grid ${className}` : 'vl-grid'} data-vl-state={state}>
      {layout.items.map((item, i) => {
        const def = getWidget(item.widget);
        if (!def) return null;
        const Widget = def.component;
        const span = Math.min(item.span ?? LAYOUT_COLUMNS, LAYOUT_COLUMNS);

        const decision = resolveVariant(
          presentation?.[item.widget]?.variant,
          VARIANT_TABLES[item.widget] ?? {},
          state,
          boxes[i] ?? null,
        );

        return (
          <div
            key={`${item.widget}-${i}`}
            ref={attach}
            className="vl-slot"
            data-vl-index={i}
            data-vl-span={span}
            // Exposed so the decision is inspectable - in the browser,
            // in a test, and by anyone wondering why a theme's
            // illustration did not appear on a particular screen.
            data-vl-variant={decision.variant}
            data-vl-variant-reason={decision.reason}
            style={{
              gridColumn: item.column ? `${item.column} / span ${span}` : `span ${span}`,
            }}
          >
            <Widget state={state} variant={decision.variant === STANDARD ? undefined : decision.variant} />
          </div>
        );
      })}
    </div>
  );
}
