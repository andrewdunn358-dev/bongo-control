import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BatteryCharging } from 'lucide-react';
import { VanOSBattery } from '@/components/VanOSGraphics';
import { api } from '@/lib/api';
import { useBattery, useEnvironment, useSparkBuffer } from '@/lib/telemetry';
import { fmtVolt, fmtTemp, fmtPct, DASH } from '@/lib/format';
import type { BatteryPayload } from '@/lib/types';
import { Spark, DataRow } from './shared';

/** BATTERY.
 *
 *  TRUTH: BATTERY has two publishers (Victron MPPT and the SmartShunt).
 *  State of charge is only real when a shunt is fitted, and shunt
 *  presence is never inferred from current_a alone - that bug has been
 *  fixed here once already. Anything absent renders as DASH rather than
 *  as a plausible-looking number. */
export function BatteryWidget() {
  const battery = useBattery();
  const env = useEnvironment();
  const voltSeries = useSparkBuffer<BatteryPayload>('battery', (p) => p.voltage);
  const { data: brief } = useQuery({ queryKey: ['mission-brief'], queryFn: api.missionBrief, refetchInterval: 30_000 });
  const bp = battery.payload;
  const topPred = brief?.predictions?.[0];
  const predictedUsage = topPred?.value == null ? DASH : `${topPred.value}${topPred.unit ? ` ${topPred.unit}` : ''}`;
  const batteryState =
    bp == null ? DASH : bp.charging ? 'CHARGING' : bp.current_a != null && Math.abs(bp.current_a) < 0.2 ? 'RESTING' : 'DISCHARGING';

  return (
    <Link to="/power" className="vm-card vm-battery-card">
      <div className="vm-card-head">
        <div>
          <span className="vm-eyebrow">POWER CORE</span>
          <h3>Battery <em>{bp?.charging ? 'Charging' : ''}</em></h3>
        </div>
        <BatteryCharging size={25} className={bp?.charging ? 'vm-green' : ''} />
      </div>
      <div className="vm-battery-main">
        <VanOSBattery soc={bp?.soc_pct} charging={bp?.charging} size={118} />
        <div className="vm-battery-value">
          <strong>{fmtPct(bp?.soc_pct)}</strong>
          <span>{fmtVolt(bp?.voltage)}</span>
        </div>
      </div>
      {bp?.soc_pct != null && (
        <div className="vm-progress">
          <i style={{ width: `${Math.max(0, Math.min(100, bp.soc_pct))}%` }} />
        </div>
      )}
      <div className="vm-data-box">
        <DataRow label="Current" value={bp?.current_a == null ? DASH : `${bp.current_a >= 0 ? '+' : ''}${bp.current_a.toFixed(1)} A`} />
        <DataRow label="State" value={batteryState} />
        <DataRow label="Temperature" value={fmtTemp(env.payload?.internal_temp_c)} />
        {topPred && <DataRow label={topPred.label} value={predictedUsage} />}
      </div>
      <Spark data={voltSeries} kind="battery" />
    </Link>
  );
}
