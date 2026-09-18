import { BatteryWidget } from './BatteryWidget';
import { SolarWidget } from './SolarWidget';
import { PowerFlowWidget } from './PowerFlowWidget';
import { WeatherWidget } from './WeatherWidget';
import { HeroWidget } from './HeroWidget';
import { FooterWidget } from './FooterWidget';
import { HeaterActionWidget, RoofActionWidget, SwitchesActionWidget, CameraActionWidget } from './ActionWidget';
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
  {
    id: 'hero',
    name: 'Hero',
    description: 'Themed identity panel with the van\u2019s name over a photograph',
    domains: [],
    truth: 'shows no reading, so it can state nothing false; deliberately carries no live camera',
    priority: 'low',
    component: HeroWidget,
  },
  {
    id: 'action-heater',
    name: 'Heater tile',
    description: 'Opens the heater screen and shows the heater\u2019s reported state',
    domains: ['heater'],
    truth: 'says \u201cNo signal\u201d when the heater is unreachable rather than implying it is off',
    priority: 'high',
    component: HeaterActionWidget,
  },
  {
    id: 'action-roof',
    name: 'Roof tile',
    description: 'Opens the roof screen',
    domains: [],
    truth: 'navigation only - claims nothing about roof position, which has no sensor',
    priority: 'high',
    component: RoofActionWidget,
  },
  {
    id: 'action-switches',
    name: 'Switches tile',
    description: 'Opens the relay switch panel',
    domains: [],
    truth: 'navigation only - claims no relay state',
    priority: 'high',
    component: SwitchesActionWidget,
  },
  {
    id: 'action-camera',
    name: 'Camera tile',
    description: 'Opens the live camera screen',
    domains: [],
    truth: 'navigation only',
    priority: 'high',
    component: CameraActionWidget,
  },
  {
    id: 'footer',
    name: 'Position footer',
    description: 'GPS position, satellite count and the app marks',
    domains: ['location'],
    truth: 'shows \u201cLocation unavailable\u201d with no fix rather than a stale coordinate',
    priority: 'medium',
    component: FooterWidget,
  },
];

export const WIDGET_IDS = WIDGETS.map((w) => w.id);

/** Unknown ids resolve to undefined rather than throwing: a theme built
 *  for a newer VanOS must degrade by skipping what it cannot render,
 *  never by taking the cockpit down with it. */
export function getWidget(id: string): WidgetDefinition | undefined {
  return WIDGETS.find((w) => w.id === id);
}
