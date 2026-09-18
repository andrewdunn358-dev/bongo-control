import { BatteryWidget } from './BatteryWidget';
import { SolarWidget } from './SolarWidget';
import { PowerFlowWidget } from './PowerFlowWidget';
import { WeatherWidget } from './WeatherWidget';
import type { WidgetDefinition } from './types';

/**
 * THE WIDGET REGISTRY.
 *
 * The authoritative list of things a layout is allowed to place. A theme
 * names ids from here and nothing else - which is what keeps a theme
 * package data rather than code, exactly as the bounded `cockpit` field
 * already works today.
 *
 * Phase 2 scope: the four Home cards that all three cockpits were
 * implementing separately. Roof, relays, camera and GPS follow, and the
 * honesty guard must be repointed at their widget files in the SAME
 * change that makes them widget-driven - otherwise it goes on passing
 * against screens that no longer drive the UI.
 */
export const WIDGETS: WidgetDefinition[] = [
  {
    id: 'battery',
    name: 'Battery',
    description: 'State of charge, voltage, current and recent history',
    domains: ['battery', 'environment'],
    truth: 'SoC only when a shunt is fitted; shunt presence is never inferred from current_a alone',
    priority: 'critical',
    component: BatteryWidget,
  },
  {
    id: 'solar',
    name: 'Solar',
    description: 'MPPT output, today\u2019s yield and peak',
    domains: ['solar'],
    truth: 'MPPT figures only - not total van production',
    priority: 'high',
    component: SolarWidget,
  },
  {
    id: 'power-flow',
    name: 'Power flow',
    description: 'Solar in, battery, systems out, and the net balance',
    domains: ['solar', 'battery', 'energy'],
    truth: 'total van draw is not measurable without a shunt and must not be implied',
    priority: 'high',
    component: PowerFlowWidget,
  },
  {
    id: 'weather',
    name: 'Weather',
    description: 'Outside temperature, conditions and tomorrow\u2019s radiation',
    domains: ['environment', 'weather'],
    truth: 'tomorrow\u2019s radiation is a forecast, labelled relative to today',
    priority: 'low',
    component: WeatherWidget,
  },
];

export const WIDGET_IDS = WIDGETS.map((w) => w.id);

/** Unknown ids resolve to undefined rather than throwing: a theme built
 *  for a newer VanOS must degrade by skipping what it cannot render,
 *  never by taking the cockpit down with it. */
export function getWidget(id: string): WidgetDefinition | undefined {
  return WIDGETS.find((w) => w.id === id);
}
