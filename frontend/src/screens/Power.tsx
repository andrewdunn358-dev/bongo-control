import { BatteryCharging, Sun, Gauge, Activity } from 'lucide-react';
import { useBattery, useSolar, useSparkBuffer, hasShunt } from '@/lib/telemetry';
import type { BatteryPayload, SolarPayload } from '@/lib/types';
import { fmtVolt, fmtWatt, fmtAmp, fmtWh, DASH } from '@/lib/format';
import { POWER } from '@/constants/testIds';
import './power.css';

function Metric({ label, value, sub, accent = 'cyan' }: { label: string; value: string; sub?: string; accent?: 'cyan' | 'purple' | 'orange' }) {
  return <div className={`pc-metric pc-${accent}`}><span>{label}</span><strong>{value}</strong>{sub && <small>{sub}</small>}</div>;
}

function Graph({ data, kind }: { data: number[]; kind: 'battery' | 'solar' | 'flow' }) {
  if (data.length < 2) return <div className="pc-graph-empty">Waiting for live history…</div>;
  const lo = Math.min(...data), hi = Math.max(...data), span = Math.max(kind === 'battery' ? .4 : kind === 'flow' ? 50 : 25, hi - lo);
  const points = data.map((v, i) => `${i / (data.length - 1) * 500},${72 - ((v - lo) / span) * 64}`).join(' ');
  return <svg className={`pc-graph pc-graph-${kind}`} viewBox="0 0 500 76" preserveAspectRatio="none"><polyline points={points} /></svg>;
}

export function Power() {
  const b = useBattery(), s = useSolar();
  const bp = b.payload, sp = s.payload;
  const voltSeries = useSparkBuffer<BatteryPayload>('battery', x => x.voltage);
  const flowSeries = useSparkBuffer<BatteryPayload>('battery', x => x.power_w);
  const solarSeries = useSparkBuffer<SolarPayload>('solar', x => x.watts);
  const shuntPresent = hasShunt(bp);

  return <div data-testid={POWER.root} className="pc-page">
    <header className="pc-heading">
      <div><span className="pc-kicker">VANOS · POWER SYSTEM</span><h1>Power <em>Core</em></h1><p>Measured battery and solar telemetry from the van.</p></div>
      <div className="pc-live"><i /> LIVE TELEMETRY</div>
    </header>

    <section className="pc-flow-hero">
      <div className="pc-flow-node pc-solar-node"><Sun size={30}/><span>SOLAR</span><strong>{fmtWatt(sp?.watts)}</strong><small>{(sp?.charge_state || 'OFF').toUpperCase()}</small></div>
      <div className="pc-flow-track"><i/><i/><i/><i/><i/></div>
      <div className="pc-flow-node pc-battery-node"><BatteryCharging size={32}/><span>BATTERY</span><strong>{fmtVolt(bp?.voltage)}</strong><small>{shuntPresent ? fmtAmp(bp?.current_a) : 'VOLTAGE ONLY'}</small></div>
    </section>

    <section className="pc-grid">
      <section className="pc-panel pc-battery" data-testid={POWER.batteryVoltage}>
        <div className="pc-panel-top"><div><span className="pc-kicker">BANK STATUS</span><h2>Battery</h2></div><Gauge size={24}/></div>
        <div className="pc-big-number">{fmtVolt(bp?.voltage)}</div>
        <div className="pc-soc"><div style={{width:`${Math.max(0,Math.min(100,bp?.soc_pct ?? 0))}%`}}/><span>{bp?.soc_pct == null ? `${DASH}%` : `${bp.soc_pct.toFixed(0)}%`}</span></div>
        <div className="pc-metrics">
          <Metric label="Current" value={bp?.current_a == null ? DASH : fmtAmp(bp.current_a)} sub={shuntPresent ? 'SmartShunt' : 'No shunt reading'} />
          <Metric label="Battery power" value={bp?.power_w == null ? DASH : fmtWatt(bp.power_w)} accent="purple" />
          <Metric label="Bank" value={bp?.bank_amp_hours != null ? `${bp.bank_amp_hours.toFixed(0)} Ah` : DASH}/>
        </div>
        <Graph data={voltSeries} kind="battery" />
      </section>

      <section className="pc-panel pc-solar" data-testid={POWER.solarWatts}>
        <div className="pc-panel-top"><div><span className="pc-kicker">VICTRON MPPT</span><h2>Solar</h2></div><Sun size={25}/></div>
        <div className="pc-big-number">{fmtWatt(sp?.watts)}</div>
        <div className="pc-solar-state"><span>{(sp?.charge_state || 'off').toUpperCase()}</span><b>PEAK {fmtWatt(sp?.peak_today_watts)}</b></div>
        <div className="pc-metrics">
          <Metric label="Yield today" value={fmtWh(sp?.yield_today_wh ?? null)} />
          <Metric label="MPPT load" value={fmtAmp(sp?.load_current_a ?? null)} accent="purple" />
          <Metric label="MPPT load power" value={fmtWatt(sp?.load_power_w ?? null)}/>
        </div>
        <Graph data={solarSeries} kind="solar" />
      </section>

      <section className="pc-panel pc-net" data-testid={POWER.net}>
        <div className="pc-panel-top"><div><span className="pc-kicker">SHUNT TELEMETRY</span><h2>Battery flow</h2></div><Activity size={24}/></div>
        <div className="pc-net-value">{bp?.power_w == null ? DASH : fmtWatt(bp.power_w)}</div>
        <p>{bp?.power_w == null ? 'No SmartShunt power reading is available.' : bp.power_w > 0 ? 'Measured power flowing into the battery.' : bp.power_w < 0 ? 'Measured power flowing out of the battery.' : 'Battery power is currently balanced.'}</p>
        <div className="pc-balance"><span>Current <b>{bp?.current_a == null ? DASH : fmtAmp(bp.current_a)}</b></span><span>Voltage <b>{fmtVolt(bp?.voltage)}</b></span></div>
        <Graph data={flowSeries} kind="flow" />
      </section>

      <section className="pc-panel pc-circuits" data-testid={POWER.loads}>
        <div className="pc-panel-top"><div><span className="pc-kicker">CIRCUIT SENSING</span><h2>Individual loads</h2></div><BatteryCharging size={22}/></div>
        <div className="pc-honest">
          <div>
            <strong>Not fitted</strong>
            <p>VanOS has no individual circuit current sensors. Relay commands do not tell us whether a fridge, light or pump is actually drawing power, so this page does not invent ON/OFF load states.</p>
          </div>
        </div>
      </section>
    </section>
  </div>;
}
