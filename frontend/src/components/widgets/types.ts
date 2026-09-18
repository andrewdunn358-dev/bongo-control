import type { ComponentType } from 'react';

/**
 * WHAT A WIDGET DECLARES ABOUT ITSELF.
 *
 * A layout is data, so it can only name widgets and say roughly how big
 * they should be. Everything else - what data it needs, how small it can
 * usefully get, what it is allowed to drop under pressure, and what it
 * must never stop saying - belongs to the widget, not to the theme.
 *
 * The rule the fitting work arrived at, stated once here rather than
 * repeated per widget: a presentation state may drop DECORATION. It may
 * never drop a READING. Nothing with a number in it disappears because
 * the screen got smaller.
 */

/** How much of itself a widget is drawing. The layout engine asks for a
 *  state; the widget decides what that means for its own content. The
 *  theme author never writes responsive CSS. */
export type WidgetState = 'full' | 'compact' | 'minimal';

/** Which widgets give way first when height runs out. `critical` is
 *  never reduced below `compact`, and never removed. */
export type WidgetPriority = 'critical' | 'high' | 'medium' | 'low';

export interface WidgetDefinition {
  id: string;
  name: string;
  description: string;
  /** Telemetry domains this widget reads. Declared so a layout can be
   *  checked against what the van actually publishes, and so a widget
   *  whose data is absent can be handled deliberately rather than
   *  rendering a blank. */
  domains: string[];
  /** The honesty constraint this widget carries, in one line. Not
   *  decorative: these are the things a theme must never be able to
   *  change, and the CI guard asserts the wording that expresses them
   *  is still present in the component. */
  truth?: string;
  priority: WidgetPriority;
  /** Smallest size at which this widget is still worth showing, in CSS
   *  pixels. TO BE MEASURED per widget - deliberately optional for now
   *  rather than guessed, because estimated sizes have run optimistic
   *  every time on this project. */
  minWidth?: number;
  minHeight?: number;
  component: ComponentType<WidgetProps>;
}

export interface WidgetProps {
  /** Defaults to 'full'. Widgets that do not yet implement states
   *  ignore it and render as they always have - which is what keeps
   *  this extraction a no-op visually. */
  state?: WidgetState;
}
