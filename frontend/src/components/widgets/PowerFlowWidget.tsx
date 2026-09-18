import { Link } from 'react-router-dom';
import { BatteryCharging, Zap } from 'lucide-react';
import { VanOSSolar } from '@/components/VanOSGraphics';
import { useBattery, useSolar, useEnergy } from '@/lib/telemetry';
import { fmtWatt, fmtPct } from '@/lib/format';

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
export function PowerFlowWidget() {
  const battery = useBattery(), solar = useSolar(), energy = useEnergy();
  const bp = battery.payload, sp = solar.payload, ep = energy.payload;

  return (
    <Link to="/power" className="vm-card vm-flow-card">
      <div className="vm-card-head">
        <div>
          <span className="vm-eyebrow">ENERGY</span>
          <h3>Power Flow</h3>
        </div>
        <Zap size={25} className="vm-cyan" />
      </div>
      <div className="vm-flow-visual">
        <div>
          <VanOSSolar size={43} active={Boolean(sp?.watts)} />
          <strong>{fmtWatt(sp?.watts)}</strong>
          <span>Solar</span>
        </div>
        <div className="vm-flow-line"><i /><i /><i /><i /></div>
        <div>
          <BatteryCharging size={43} />
          <strong>{fmtPct(bp?.soc_pct)}</strong>
          <span>Battery</span>
        </div>
        <div className="vm-flow-line"><i /><i /><i /><i /></div>
        <div>
          <Zap size={43} />
          <strong>{fmtWatt(ep?.load_watts)}</strong>
          <span>Systems</span>
        </div>
      </div>
      <div className="vm-flow-total">
        <span>NET BALANCE</span>
        <strong>{fmtWatt(ep?.net_watts)}</strong>
      </div>
    </Link>
  );
}
