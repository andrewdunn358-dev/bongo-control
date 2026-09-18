/**
 * THE LAYOUT SCHEMA.
 *
 * A layout says WHAT GOES WHERE. It does not say how that is physically
 * laid out - no widths, gaps, margins, pixels, grid-template-columns or
 * transforms. Those belong to the renderer, and keeping them out is the
 * whole point: a schema that can express CSS eventually becomes CSS in
 * JSON, and then every layout has to solve the responsive problem for
 * itself.
 *
 *   schema   = allocation intent
 *   renderer = physical implementation
 *
 * The schema does NOT import the registry. It is handed the list of
 * known widget ids instead, so this module stays free of React and of
 * the widget components - which is what lets the theme parser use it
 * without dragging the whole widget tree, or a cycle, along with it.
 *
 * Twelve columns is a LOGICAL grid, not a promise of twelve physical
 * columns on every screen. A span of 3 means "a quarter of the row when
 * there is room"; the renderer decides what that becomes on a phone.
 */

export const LAYOUT_COLUMNS = 12;
export const LAYOUT_VERSION = 1;

/** The only keys a layout item may carry. Anything else is rejected
 *  rather than ignored, so a future CSS-ish property cannot arrive by
 *  being quietly passed through. */
const ITEM_KEYS = new Set(['widget', 'span', 'column']);

export interface LayoutItem {
  /** A widget id from the registry. */
  widget: string;
  /** Logical columns to occupy, 1-12. Defaults to the full row. */
  span?: number;
  /** Optional explicit start column, 1-12. Omit to let items flow in
   *  order, which is what most layouts want. */
  column?: number;
}

export interface LayoutDefinition {
  version: number;
  items: LayoutItem[];
}

export class LayoutError extends Error {}

/**
 * Validates a layout and returns a safe copy.
 *
 * Unknown WIDGET ids are dropped with a warning rather than throwing: a
 * layout written for a newer VanOS must degrade by leaving a gap, never
 * by taking the page down. Unknown PROPERTIES are a different matter
 * and do throw - they mean the layout is trying to say something this
 * schema deliberately cannot express.
 */
export function parseLayout(raw: unknown, knownWidgets: readonly string[]): { layout: LayoutDefinition; skipped: string[] } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new LayoutError('A layout must be a JSON object.');
  }
  const obj = raw as Record<string, unknown>;

  const version = typeof obj.version === 'number' ? obj.version : NaN;
  if (!Number.isInteger(version)) throw new LayoutError('The layout has no version number.');
  if (version > LAYOUT_VERSION) {
    throw new LayoutError(`This layout needs a newer VanOS (layout v${version}, this build supports v${LAYOUT_VERSION}).`);
  }

  if (!Array.isArray(obj.items)) throw new LayoutError('The layout has no "items" array.');
  if (obj.items.length > 24) throw new LayoutError('That layout has too many items (24 maximum).');

  const items: LayoutItem[] = [];
  const skipped: string[] = [];

  for (const entry of obj.items as unknown[]) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new LayoutError('Every layout item must be an object.');
    }
    const it = entry as Record<string, unknown>;

    for (const key of Object.keys(it)) {
      if (!ITEM_KEYS.has(key)) {
        throw new LayoutError(
          `"${key.slice(0, 20)}" is not something a layout can set. A layout says what goes where ` +
            `(widget, span, column); how it is drawn belongs to the renderer.`,
        );
      }
    }

    if (typeof it.widget !== 'string') throw new LayoutError('Every layout item needs a "widget".');
    if (!knownWidgets.includes(it.widget)) {
      skipped.push(it.widget.slice(0, 30));
      continue;
    }

    const item: LayoutItem = { widget: it.widget };
    if (it.span !== undefined) {
      if (!Number.isInteger(it.span) || (it.span as number) < 1 || (it.span as number) > LAYOUT_COLUMNS) {
        throw new LayoutError(`"span" must be a whole number from 1 to ${LAYOUT_COLUMNS}.`);
      }
      item.span = it.span as number;
    }
    if (it.column !== undefined) {
      if (!Number.isInteger(it.column) || (it.column as number) < 1 || (it.column as number) > LAYOUT_COLUMNS) {
        throw new LayoutError(`"column" must be a whole number from 1 to ${LAYOUT_COLUMNS}.`);
      }
      item.column = it.column as number;
    }
    items.push(item);
  }

  return { layout: { version, items }, skipped };
}

/** Which drawing each widget should use. A theme names a VARIANT and
 *  nothing else - there is no route here to arbitrary styling, and a
 *  variant cannot change what a widget reads or what it says. */
export interface WidgetPresentation {
  variant?: string;
}

const PRESENTATION_KEYS = new Set(['variant']);

/**
 * Validates a theme's `widgets` block.
 *
 * An unknown widget id or an unknown VARIANT is dropped and reported,
 * not thrown: a theme built for a newer VanOS should lose its bespoke
 * drawing and fall back to the standard one, never fail to load. An
 * unknown PROPERTY still throws, for the same reason it does in a
 * layout - it means the theme is trying to say something this schema
 * deliberately cannot express.
 */
export function parseWidgetPresentation(
  raw: unknown,
  knownVariants: Record<string, string[]>,
): { presentation: Record<string, WidgetPresentation>; skipped: string[] } {
  if (raw === undefined || raw === null) return { presentation: {}, skipped: [] };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new LayoutError('The theme\u2019s "widgets" block must be an object.');
  }
  const out: Record<string, WidgetPresentation> = {};
  const skipped: string[] = [];

  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new LayoutError(`The presentation for "${id.slice(0, 24)}" must be an object.`);
    }
    for (const key of Object.keys(value)) {
      if (!PRESENTATION_KEYS.has(key)) {
        throw new LayoutError(
          `"${key.slice(0, 20)}" is not something a theme can set on a widget. A theme may name a ` +
            `variant; how that variant is drawn belongs to VanOS.`,
        );
      }
    }
    const variant = (value as WidgetPresentation).variant;
    if (variant === undefined) continue;
    if (typeof variant !== 'string') throw new LayoutError(`"variant" must be a name.`);

    const allowed = knownVariants[id];
    if (!allowed || !allowed.includes(variant)) {
      // The widget still renders - in its standard drawing.
      skipped.push(`${id.slice(0, 24)}:${variant.slice(0, 24)}`);
      continue;
    }
    out[id] = { variant };
  }
  return { presentation: out, skipped };
}
