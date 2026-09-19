import { useCallback, useEffect, useRef, useState } from 'react';
import { getWidget } from '@/components/widgets/registry';
import { DEFAULT_VARIANTS, GRAPHIC_WIDGETS, VARIANT_TABLES } from '@/components/widgets/graphics/registry';
import type { WidgetState } from '@/components/widgets/types';
import { useThemeAssets } from '@/lib/useThemeAssets';
import { chooseGraphic, type GraphicChoice } from './graphicChoice';
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
  // Every slot element handed to `attach`, kept so the observer can pick
  // them up when it is created.
  //
  // WHY THIS EXISTS. React attaches refs during commit, BEFORE it runs
  // effects - so on first render `attach` ran while the observer did not
  // exist yet, and `attach` is a stable callback that React never calls
  // again. No slot was ever observed, every slot stayed at
  // "not-measured-yet", and every variant fell back to the standard
  // drawing on every screen. That is why a theme asking for the
  // illustrated graphics never got them. Measured: 380x377 slots at
  // 1920x1080, reason "not-measured-yet", indefinitely.
  const slots = useRef(new Set<HTMLDivElement>());

  useEffect(() => {
    const ro = new ResizeObserver((entries) => {
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
    observer.current = ro;
    // The slots attached before this effect ran - which on first render
    // is all of them.
    slots.current.forEach((node) => ro.observe(node));
    return () => {
      ro.disconnect();
      observer.current = null;
    };
  }, []);

  const attach = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    slots.current.add(node);
    observer.current?.observe(node);
  }, []);

  // Packaged images, declared and confirmed present - never guessed.
  const { asset } = useThemeAssets();

  return (
    <div className={className ? `vl-grid ${className}` : 'vl-grid'} data-vl-state={state}>
      {layout.items.map((item, i) => {
        const def = getWidget(item.widget);
        if (!def) return null;
        const Widget = def.component;
        const span = Math.min(item.span ?? LAYOUT_COLUMNS, LAYOUT_COLUMNS);

        const table = VARIANT_TABLES[item.widget] ?? {};
        const box = boxes[i] ?? null;
        const themeVariant = presentation?.[item.widget]?.variant;

        // GRAPHIC widgets go through the one precedence rule: theme
        // graphic, then packaged image, then VanOS's own drawing. Other
        // widgets only have presentation styles, resolved as before.
        let variant: string | undefined;
        let reason: string;
        let graphic: GraphicChoice | undefined;
        let source: GraphicChoice['source'] | undefined;
        if (GRAPHIC_WIDGETS.has(item.widget)) {
          graphic = chooseGraphic({
            themeVariant,
            asset: asset(item.widget, '') || undefined,
            defaultVariant: DEFAULT_VARIANTS[item.widget],
            table,
            state,
            box,
          });
          source = graphic.source;
          variant = graphic.variant;
          reason = graphic.reason;
        } else {
          const decision = resolveVariant(themeVariant, table, state, box);
          variant = decision.variant;
          reason = decision.reason;
        }

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
            data-vl-variant={variant}
            data-vl-variant-reason={reason}
            data-vl-graphic-source={source}
            style={{
              gridColumn: item.column ? `${item.column} / span ${span}` : `span ${span}`,
            }}
          >
            <Widget
              state={state}
              variant={variant === STANDARD ? undefined : variant}
              graphic={graphic}
            />
          </div>
        );
      })}
    </div>
  );
}
