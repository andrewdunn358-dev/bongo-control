import type { LayoutDefinition } from './schema';

/**
 * Adventure's telemetry row, expressed as DATA rather than as markup.
 *
 * This is the same four widgets in the same order the cockpit rendered
 * by hand until now. Four spans of 3 - a quarter of the logical row
 * each - which the renderer turns into four across when there is room
 * and collapses when there is not.
 *
 * It lives in code for Phase 4. The identical shape comes out of a
 * .vanos-theme package once the package format carries a layout, and
 * nothing in the renderer changes when it does.
 */
export const ADVENTURE_CORE: LayoutDefinition = {
  version: 1,
  items: [
    { widget: 'battery', span: 3 },
    { widget: 'solar', span: 3 },
    { widget: 'power-flow', span: 3 },
    { widget: 'weather', span: 3 },
  ],
};
