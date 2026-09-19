import { Link } from 'react-router-dom';
import { BatteryCharging, Zap } from 'lucide-react';
import { VanOSSolar } from '@/components/VanOSGraphics';
import { POWER_FLOW_GRAPHICS } from './graphics/registry';
import { GraphicSlot, choiceFromVariant } from './graphics/GraphicSlot';
import { powerFlowDirection } from './graphics/derive';
import { useBattery, useSolar, useEnergy } from '@/lib/telemetry';
import { fmtWatt, fmtPct } from '@/lib/format';
import type { WidgetProps } from './types';

/** PHASE 2 NOTE: this widget still renders Adventure's vm-* classes,
 *  which are defined in adventure.css - a lazy chunk. Placed outside
 *  Adventure today it would be unstyled. See widgets/STYLING.md for the
 *  measured coupling and the route to presentation-independence. */
/** POWER FLOW.
 *
 *  TRUTH: the Systems figure comes from the MPPT, and total van draw is
 *  not measurable without a shunt. This widget shows the three figures
 *  it actually has and the net balance between them; it must not be
 *  presented as a complete account of where the power goes. */
export function PowerFlowWidget({ state = 'full', variant, graphic }: WidgetProps) {
  const battery = useBattery(), solar = useSolar(), energy = useEnergy();
  const bp = battery.payload, sp = solar.payload, ep = energy.payload;
  // The standard drawing is this widget's own inline markup below; any
  // other drawing, or a packaged image, goes in the graphic container.
  const choice = graphic ?? choiceFromVariant(variant);
  const inContainer = Boolean(variant) || choice.source === 'theme-asset';

  return (
    <Link to="/power" className="vw-card vw-flow-card" data-vw-state={state} data-vw-variant={variant ?? 'standard'}>
      <div className="vw-card-head">
        <div>
          <span className="vw-eyebrow">ENERGY</span>
          <h3>Power Flow</h3>
        </div>
        <Zap size={25} className="vw-cyan" />
      </div>
      {inContainer ? (
        <div className="vw-flow-visual vw-flow-illustrated">
          <GraphicSlot
            table={POWER_FLOW_GRAPHICS}
            choice={choice}
            artClass="power"
            alt="Solar to battery to systems power flow"
            props={{
              solarWatts: sp?.watts,
              loadWatts: ep?.load_watts,
              netWatts: ep?.net_watts,
              direction: powerFlowDirection(ep?.net_watts),
            }}
          />
          <div className="vw-flow-readouts">
            <div><strong>{fmtWatt(sp?.watts)}</strong><span>Solar</span></div>
            <div><strong>{fmtPct(bp?.soc_pct)}</strong><span>Battery</span></div>
            <div><strong>{fmtWatt(ep?.load_watts)}</strong><span>Systems</span></div>
          </div>
        </div>
      ) : (
        <div className="vw-flow-visual">
          <div>
            <VanOSSolar size={43} active={Boolean(sp?.watts)} />
            <strong>{fmtWatt(sp?.watts)}</strong>
            <span>Solar</span>
          </div>
          <div className="vw-flow-line"><i /><i /><i /><i /></div>
          <div>
            <BatteryCharging size={43} />
            <strong>{fmtPct(bp?.soc_pct)}</strong>
            <span>Battery</span>
          </div>
          <div className="vw-flow-line"><i /><i /><i /><i /></div>
          <div>
            <Zap size={43} />
            <strong>{fmtWatt(ep?.load_watts)}</strong>
            <span>Systems</span>
          </div>
        </div>
      )}
      <div className="vw-flow-total">
        <span>NET BALANCE</span>
        <strong>{fmtWatt(ep?.net_watts)}</strong>
      </div>
    </Link>
  );
}
