import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { endpoints } from '@/lib/api';
import { GlassCard, CardHeader } from '@/components/primitives/GlassCard';
import { StatusPill } from '@/components/primitives/StatusPill';
import { HIST } from '@/constants/testIds';
import { cn } from '@/lib/utils';

const RANGES = [
  { key: '1h', label: '1H', testId: HIST.range1h },
  { key: '24h', label: '24H', testId: HIST.range24h },
  { key: '7d', label: '7D', testId: HIST.range7d },
  { key: '30d', label: '30D', testId: HIST.range30d },
];

const fmtTime = (iso, range) => {
  const d = new Date(iso);
  if (range === '1h' || range === '24h') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

export const HistoryScreen = () => {
  const [range, setRange] = useState('24h');

  const battery = useQuery({ queryKey: ['history', 'battery', range], queryFn: () => endpoints.history('battery', range) });
  const solar = useQuery({ queryKey: ['history', 'solar', range], queryFn: () => endpoints.history('solar', range) });
  const load = useQuery({ queryKey: ['history', 'load', range], queryFn: () => endpoints.history('load', range) });
  const temp = useQuery({ queryKey: ['history', 'temp', range], queryFn: () => endpoints.history('temp', range) });

  const batterySeries = useMemo(() => (battery.data?.series || []).map((s) => ({ ...s, t: fmtTime(s.t, range) })), [battery.data, range]);
  const solarSeries = useMemo(() => (solar.data?.series || []).map((s) => ({ ...s, t: fmtTime(s.t, range) })), [solar.data, range]);
  const loadSeries = useMemo(() => (load.data?.series || []).map((s) => ({ ...s, t: fmtTime(s.t, range) })), [load.data, range]);
  const tempSeries = useMemo(() => (temp.data?.series || []).map((s) => ({ ...s, t: fmtTime(s.t, range) })), [temp.data, range]);

  return (
    <div data-testid={HIST.root} className="mx-auto max-w-[1500px] px-4 sm:px-6 lg:px-10 py-6 lg:py-10">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">History graphs</div>
          <h1 className="text-3xl md:text-5xl font-semibold text-white tracking-tight mt-1">
            Look <span className="text-aurora-teal">back</span>, plan ahead.
          </h1>
          <div className="text-sm text-slate-400 mt-2">
            Battery state, solar harvest, load draw & temperature across the last {rangeToWords(range)}.
          </div>
        </div>
        <div className="inline-flex bg-white/[0.03] ring-1 ring-white/10 rounded-full p-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              data-testid={r.testId}
              type="button"
              onClick={() => setRange(r.key)}
              className={cn(
                'text-xs px-4 py-1.5 rounded-full transition',
                range === r.key
                  ? 'bg-aurora-teal text-navy-900 font-semibold'
                  : 'text-slate-300 hover:text-white'
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4 lg:gap-6">
        <GlassCard glow="teal" className="col-span-12 lg:col-span-7 p-6" data-testid={HIST.batteryChart}>
          <CardHeader label="Battery · state of charge" hint="%" right={<StatusPill tone="teal">SOC</StatusPill>} />
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={batterySeries} margin={{ top: 10, right: 10, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
                <XAxis dataKey="t" tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={40} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false} axisLine={false} domain={[0, 100]} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#e6f0ff' }} />
                <Line type="monotone" dataKey="value" stroke="#22d3ee" strokeWidth={2.4} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>

        <GlassCard glow="purple" className="col-span-12 lg:col-span-5 p-6" data-testid={HIST.solarChart}>
          <CardHeader label="Solar · harvest" hint="W" right={<StatusPill tone="purple">MPPT</StatusPill>} />
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={solarSeries} margin={{ top: 10, right: 10, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="solarArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#a855f7" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#a855f7" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
                <XAxis dataKey="t" tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={40} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#e6f0ff' }} />
                <Area type="monotone" dataKey="value" stroke="#a855f7" strokeWidth={2.2} fill="url(#solarArea)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>

        <GlassCard className="col-span-12 lg:col-span-6 p-6">
          <CardHeader label="Load · draw" hint="W" />
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={loadSeries} margin={{ top: 10, right: 10, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="loadArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
                <XAxis dataKey="t" tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={40} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#e6f0ff' }} />
                <Area type="monotone" dataKey="value" stroke="#38bdf8" strokeWidth={2} fill="url(#loadArea)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>

        <GlassCard className="col-span-12 lg:col-span-6 p-6">
          <CardHeader label="Interior · temperature" hint="°C" />
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={tempSeries} margin={{ top: 10, right: 10, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
                <XAxis dataKey="t" tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={40} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#e6f0ff' }} />
                <Line type="monotone" dataKey="value" stroke="#f472b6" strokeWidth={2.2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>
      </div>
    </div>
  );
};

const tooltipStyle = {
  background: 'rgba(15,41,66,0.9)',
  border: '1px solid rgba(34,211,238,0.3)',
  borderRadius: 12,
  color: '#e6f0ff',
};

function rangeToWords(r) {
  return { '1h': 'hour', '24h': 'day', '7d': 'week', '30d': 'month' }[r] || '';
}
