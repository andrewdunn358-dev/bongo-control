import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BatteryCharging } from 'lucide-react';
import { api } from '@/lib/api';
import { hasShunt, useBattery, useEnvironment, useSparkBuffer } from '@/lib/telemetry';
import { fmtVolt, fmtTemp, fmtPct, DASH } from '@/lib/format';
import type { BatteryPayload } from '@/lib/types';
import { RESTING_CURRENT_A, timeToFullMins } from '@/lib/batteryDerive';
import { Spark, DataRow } from './shared';
import { BATTERY_GRAPHICS } from './graphics/registry';
import { GraphicSlot, choiceFromVariant } from './graphics/GraphicSlot';
import type { WidgetProps } from './types';

/** PHASE 2 NOTE: this widget still renders Adventure's vm-* classes,
 *  which are defined in adventure.css - a lazy chunk. Placed outside
 *  Adventure today it would be unstyled. See widgets/STYLING.md for the
 *  measured coupling and the route to presentation-independence. */
/** BATTERY.
 *
 *  TRUTH: BATTERY has two publishers (Victron MPPT and the SmartShunt).
 *  State of charge is only real when a shunt is fitted, and shunt
 *  presence is never inferred from current_a alone - that bug has been
 *  fixed here once already. Anything absent renders as DASH rather than
 *  as a plausible-looking number. */
export function BatteryWidget({ state = 'full', variant, graphic }: WidgetProps) {
  // The DRAWING was chosen by the renderer; the DATA comes from here.
  const battery = useBattery();
  const env = useEnvironment();
  const voltSeries = useSparkBuffer<BatteryPayload>('battery', (p) => p.voltage);
  const { data: brief } = useQuery({ queryKey: ['mission-brief'], queryFn: api.missionBrief, refetchInterval: 30_000 });
  const bp = battery.payload;
  const topPred = brief?.predictions?.[0];
  const predictedUsage = topPred?.value == null ? DASH : `${topPred.value}${topPred.unit ? ` ${topPred.unit}` : ''}`;
  const batteryState =
    bp == null ? DASH : bp.charging ? 'CHARGING' : bp.current_a != null && Math.abs(bp.current_a) < RESTING_CURRENT_A ? 'RESTING' : 'DISCHARGING';
  // Shunt-only readings are handed to the graphic only when a shunt is
  // fitted, per hasShunt() - so a graphic can never draw a current the
  // van did not measure.
  const shunt = hasShunt(bp);

  return (
    <Link to="/power" className="vw-card vw-battery-card" data-vw-state={state} data-vw-variant={variant ?? 'standard'}>
      <div className="vw-card-head">
        <div>
          <span className="vw-eyebrow">POWER CORE</span>
          <h3>Battery <em>{bp?.charging ? 'Charging' : ''}</em></h3>
        </div>
        <BatteryCharging size={25} className={bp?.charging ? 'vw-green' : ''} />
      </div>
      <div className="vw-battery-main">
        <GraphicSlot
          table={BATTERY_GRAPHICS}
          choice={graphic ?? choiceFromVariant(variant)}
          artClass="battery"
          props={{
            soc: bp?.soc_pct,
            charging: bp?.charging,
            size: 118,
            voltage: bp?.voltage ?? null,
            shuntFitted: shunt,
            currentA: shunt ? bp?.current_a ?? null : null,
            powerW: shunt ? bp?.power_w ?? null : null,
            timeRemainingMins: shunt ? bp?.time_remaining_mins ?? null : null,
            timeToFullMins: timeToFullMins(bp),
          }}
        />
        <div className="vw-battery-value">
          <strong>{fmtPct(bp?.soc_pct)}</strong>
          <span>{fmtVolt(bp?.voltage)}</span>
        </div>
      </div>
      {bp?.soc_pct != null && (
        <div className="vw-progress">
          <i style={{ width: `${Math.max(0, Math.min(100, bp.soc_pct))}%` }} />
        </div>
      )}
      <div className="vw-data-box">
        <DataRow label="Current" value={bp?.current_a == null ? DASH : `${bp.current_a >= 0 ? '+' : ''}${bp.current_a.toFixed(1)} A`} />
        <DataRow label="State" value={batteryState} />
        <DataRow label="Temperature" value={fmtTemp(env.payload?.internal_temp_c)} />
        {topPred && <DataRow label={topPred.label} value={predictedUsage} />}
      </div>
      <Spark data={voltSeries} kind="battery" />
    </Link>
  );
}
