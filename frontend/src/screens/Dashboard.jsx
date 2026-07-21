import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Sun, Zap, Thermometer, Droplet, Snowflake, Flame, Plug, Battery } from 'lucide-react';
import { Link } from 'react-router-dom';
import { GlassCard, CardHeader } from '@/components/primitives/GlassCard';
import { StatusPill } from '@/components/primitives/StatusPill';
import { GaugeRing } from '@/components/primitives/GaugeRing';
import { Sparkline } from '@/components/primitives/Sparkline';
import { fmtWatts, fmtVolt, fmtAmp, fmtTemp, fmtPct } from '@/lib/format';
import { DASH } from '@/constants/testIds';

const sitrepTone = (soc) => (soc >= 55 ? 'green' : soc >= 25 ? 'amber' : 'red');
const sitrepLabel = (soc) => (soc >= 55 ? 'GREEN · MISSION READY' : soc >= 25 ? 'AMBER · CONSERVE' : 'RED · CRITICAL');

const StatTile = ({ icon: Icon, label, value, unit, sub, tone = 'teal', testId }) => (
  <GlassCard className="col-span-6 sm:col-span-3 lg:col-span-3 p-4 sm:p-5" data-testid={testId}>
    <div className="flex items-start justify-between">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className={`h-8 w-8 grid place-items-center rounded-lg bg-white/5 ring-1 ring-inset ring-white/10 ${tone === 'purple' ? 'text-aurora-purple' : 'text-aurora-teal'}`}>
        <Icon size={16} />
      </div>
    </div>
    <div className="mt-3 flex items-baseline gap-1.5">
      <div className="num text-3xl sm:text-4xl font-semibold text-white">{value}</div>
      {unit && <div className="text-sm text-slate-400">{unit}</div>}
    </div>
    {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
  </GlassCard>
);

const QuickToggle = ({ label, on, icon: Icon, testId, onClick }) => (
  <button
    type="button"
    data-testid={testId}
    onClick={onClick}
    className={`flex items-center justify-between gap-3 w-full rounded-2xl px-4 py-3 transition
      ${on
        ? 'bg-gradient-to-br from-aurora-teal/15 to-aurora-purple/10 ring-1 ring-aurora-teal/40 text-white shadow-[inset_0_0_18px_rgba(34,211,238,0.15)]'
        : 'bg-white/[0.03] ring-1 ring-white/10 text-slate-300 hover:bg-white/[0.05]'
      }`}
  >
    <span className="flex items-center gap-2 text-sm">
      <Icon size={16} className={on ? 'text-aurora-teal' : 'text-slate-400'} />
      {label}
    </span>
    <span className={`num text-xs px-2 py-0.5 rounded-full ${on ? 'bg-aurora-teal/20 text-aurora-teal' : 'bg-white/5 text-slate-400'}`}>{on ? 'ON' : 'OFF'}</span>
  </button>
);

export const Dashboard = ({ telemetry }) => {
  const { frame, buffer } = telemetry;
  const soc = frame?.battery?.soc ?? 0;
  const solar = frame?.solar?.power ?? 0;
  const load = frame?.load?.power ?? 0;
  const interior = frame?.climate?.interior_c ?? 0;
  const water = frame?.tanks?.water_pct ?? 0;
  const voltage = frame?.battery?.voltage ?? 0;
  const current = frame?.battery?.current ?? 0;

  const socSeries = useMemo(() => buffer.map((f) => f.battery?.soc || 0), [buffer]);
  const solarSeries = useMemo(() => buffer.map((f) => f.solar?.power || 0), [buffer]);

  const tone = sitrepTone(soc);

  return (
    <div data-testid={DASH.root} className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 py-6 lg:py-10">
      {/* Header row */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6 lg:mb-10">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Live cockpit</div>
          <h1 className="text-3xl md:text-5xl font-semibold text-white tracking-tight mt-1">
            Good <span className="text-aurora-teal">signal</span>. All systems reporting.
          </h1>
          <div className="text-sm text-slate-400 mt-2">
            Battery, solar, climate & tanks streamed live over WebSocket · updated every second.
          </div>
        </div>
        <Link to="/sitrep" data-testid={DASH.sitrepPill}>
          <StatusPill tone={tone} className="text-sm px-4 py-1.5">
            {sitrepLabel(soc)}
          </StatusPill>
        </Link>
      </div>

      <div className="grid grid-cols-12 gap-4 lg:gap-6">
        {/* Battery gauge — hero card */}
        <GlassCard glow="teal" className="col-span-12 lg:col-span-5 p-6 lg:p-8" data-testid={DASH.batteryGauge}>
          <CardHeader label="Battery · State of Charge" hint={frame ? `${fmtVolt(voltage)} · ${fmtAmp(current)}` : 'connecting…'} right={
            <StatusPill tone={tone}>{tone.toUpperCase()}</StatusPill>
          } />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-center">
            <div className="flex justify-center">
              <GaugeRing value={soc} size={240} label="SoC" sublabel={frame?.battery?.status || ''} />
            </div>
            <div className="space-y-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Battery power</div>
                <div className="num text-3xl text-white mt-1" data-testid={DASH.batterySoc}>
                  {fmtWatts(voltage * current)}
                </div>
                <div className="mt-2">
                  <Sparkline data={socSeries} width={280} height={54} stroke="#22d3ee" fill="rgba(34,211,238,0.25)" data-testid={DASH.sparkBattery} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="rounded-xl bg-white/[0.03] ring-1 ring-white/10 p-3">
                  <div className="text-[10px] uppercase tracking-widest text-slate-400">Voltage</div>
                  <div className="num text-lg text-white mt-0.5">{fmtVolt(voltage)}</div>
                </div>
                <div className="rounded-xl bg-white/[0.03] ring-1 ring-white/10 p-3">
                  <div className="text-[10px] uppercase tracking-widest text-slate-400">Current</div>
                  <div className={`num text-lg mt-0.5 ${current >= 0 ? 'text-status-green' : 'text-status-amber'}`}>{fmtAmp(current)}</div>
                </div>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Solar card */}
        <GlassCard glow="purple" className="col-span-12 md:col-span-6 lg:col-span-4 p-6" data-testid={DASH.solarValue}>
          <CardHeader label="Solar input" hint={frame ? `${fmtNum2(frame?.solar?.today_kwh)} kWh today` : ''}
            right={<StatusPill tone="purple">MPPT</StatusPill>} />
          <div className="flex items-center justify-between">
            <div>
              <div className="num text-5xl font-semibold text-white">{Math.round(solar)}</div>
              <div className="text-sm text-slate-400 mt-1">watts incoming</div>
            </div>
            <div className="relative">
              <motion.div
                className="h-16 w-16 rounded-full bg-gradient-to-br from-aurora-purple/40 to-aurora-teal/40 grid place-items-center"
                animate={{ scale: [1, 1.06, 1] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
              >
                <Sun size={26} className="text-aurora-teal" />
              </motion.div>
            </div>
          </div>
          <div className="mt-4">
            <Sparkline data={solarSeries} width={340} height={54} stroke="#a855f7" fill="rgba(168,85,247,0.28)" data-testid={DASH.sparkSolar} />
          </div>
        </GlassCard>

        {/* Load card */}
        <GlassCard className="col-span-12 md:col-span-6 lg:col-span-3 p-6" data-testid={DASH.loadValue}>
          <CardHeader label="Live load" hint="all circuits" right={<StatusPill tone="teal">DRAW</StatusPill>} />
          <div className="flex items-end gap-2">
            <div className="num text-5xl font-semibold text-white">{Math.round(load)}</div>
            <div className="text-sm text-slate-400 pb-1.5">W</div>
          </div>
          <div className="text-xs text-slate-500 mt-1">≈ {(load / voltage || 0).toFixed(1)} A @ 12.6V</div>
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Inverter</span>
              <span className={frame?.load?.inverter_on ? 'text-status-green' : 'text-slate-500'}>{frame?.load?.inverter_on ? 'ON' : 'OFF'}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Fridge</span>
              <span className={frame?.load?.fridge_on ? 'text-status-green' : 'text-slate-500'}>{frame?.load?.fridge_on ? 'ON' : 'OFF'}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Heater</span>
              <span className={frame?.load?.heater_on ? 'text-status-amber' : 'text-slate-500'}>{frame?.load?.heater_on ? 'ON' : 'OFF'}</span>
            </div>
          </div>
        </GlassCard>

        {/* Small stats row */}
        <StatTile
          icon={Thermometer}
          label="Interior"
          value={fmtTemp(interior)}
          sub={`Outside ${fmtTemp(frame?.climate?.exterior_c ?? 0)}`}
          testId={DASH.interiorTemp}
        />
        <StatTile
          icon={Droplet}
          label="Water tank"
          value={fmtPct(water)}
          sub="Fresh water"
          testId={DASH.waterTank}
          tone="purple"
        />
        <StatTile icon={Zap} label="Solar today" value={(frame?.solar?.today_kwh ?? 0).toFixed(2)} unit="kWh" sub="cumulative" />
        <StatTile icon={Battery} label="Bank voltage" value={fmtVolt(voltage)} sub="12V LiFePO4" />

        {/* Quick controls */}
        <GlassCard className="col-span-12 lg:col-span-8 p-6">
          <CardHeader label="Quick circuits" hint="One-tap loads · optimistic UI" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <QuickToggle label="Inverter" icon={Plug} on={!!frame?.load?.inverter_on} testId={DASH.toggleInverter} onClick={() => {}} />
            <QuickToggle label="Diesel Heater" icon={Flame} on={!!frame?.load?.heater_on} testId={DASH.toggleHeater} onClick={() => {}} />
            <QuickToggle label="Fridge" icon={Snowflake} on={!!frame?.load?.fridge_on} testId={DASH.toggleFridge} onClick={() => {}} />
          </div>
        </GlassCard>

        {/* Runtime forecast card */}
        <GlassCard className="col-span-12 lg:col-span-4 p-6">
          <CardHeader label="Runtime forecast" hint="based on current draw" right={<StatusPill tone={tone}>{tone === 'green' ? 'HEALTHY' : tone.toUpperCase()}</StatusPill>} />
          <div className="num text-4xl text-white">{estimateRuntime(soc, load).toFixed(1)}<span className="text-lg text-slate-400"> h</span></div>
          <div className="text-xs text-slate-500 mt-1">
            To 15% reserve · {load.toFixed(0)}W avg
          </div>
          <div className="mt-4 h-2 rounded-full bg-white/5 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-aurora-teal via-aurora-blue to-aurora-purple transition-[width]"
              style={{ width: `${Math.max(2, Math.min(100, soc))}%` }}
            />
          </div>
          <div className="mt-2 text-[11px] text-slate-500 flex justify-between"><span>0%</span><span>50%</span><span>100%</span></div>
        </GlassCard>
      </div>
    </div>
  );
};

const fmtNum2 = (n) => (n === null || n === undefined ? '—' : Number(n).toFixed(2));

function estimateRuntime(soc, loadW) {
  const usableWh = Math.max(0, (soc - 15) / 100) * (200 * 12.6);
  const l = Math.max(loadW || 0, 50);
  return usableWh / l;
}
