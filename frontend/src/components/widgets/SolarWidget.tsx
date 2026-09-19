import { Link } from 'react-router-dom';
import { Sun } from 'lucide-react';
import { useThemeAssets } from '@/lib/useThemeAssets';

import { useSolar, useSparkBuffer } from '@/lib/telemetry';
import { fmtWatt, DASH } from '@/lib/format';
import type { SolarPayload } from '@/lib/types';
import { Spark, DataRow } from './shared';
import { SOLAR_GRAPHICS, pick } from './graphics/registry';
import type { WidgetProps } from './types';

/** PHASE 2 NOTE: this widget still renders Adventure's vm-* classes,
 *  which are defined in adventure.css - a lazy chunk. Placed outside
 *  Adventure today it would be unstyled. See widgets/STYLING.md for the
 *  measured coupling and the route to presentation-independence. */
/** SOLAR. Real telemetry from the Victron MPPT. Yield and peak are the
 *  MPPT's own figures - they are NOT total van production or draw, and
 *  nothing here should imply otherwise. */
export function SolarWidget({ state = 'full', variant }: WidgetProps) {
  const SolarArt = pick(SOLAR_GRAPHICS, variant);
  const { asset } = useThemeAssets();
  const solar = useSolar();
  const solarSeries = useSparkBuffer<SolarPayload>('solar', (p) => p.watts);
  const sp = solar.payload;

  return (
    <Link to="/power" className="vw-card vw-solar-card" data-vw-state={state} data-vw-variant={variant ?? 'standard'}>
      <div className="vw-card-head">
        <div>
          <span className="vw-eyebrow">SOLAR · VICTRON</span>
          <h3>Solar</h3>
        </div>
        <Sun size={27} className="vw-sun" />
      </div>
      <div className="vw-solar-visual">
        <SolarArt size={74} active={Boolean(sp?.watts)} asset={asset('solar', '') || undefined} />
        <div>
          <strong>{fmtWatt(sp?.watts)}</strong>
          <span>{sp?.watts ? 'GENERATING' : (sp?.charge_state || 'OFF').toUpperCase()}</span>
        </div>
      </div>
      <div className="vw-data-box">
        <DataRow label="Today" value={sp?.yield_today_wh == null ? DASH : `${(sp.yield_today_wh / 1000).toFixed(2)} kWh`} />
        <DataRow label="Peak" value={fmtWatt(sp?.peak_today_watts)} />
        <DataRow label="Charge state" value={(sp?.charge_state || 'off').toUpperCase()} />
      </div>
      <Spark data={solarSeries} kind="solar" />
    </Link>
  );
}
