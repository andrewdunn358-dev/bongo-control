import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { GlassCard, CardHeader } from '@/components/primitives/GlassCard';
import { StatusPill } from '@/components/primitives/StatusPill';
import { api } from '@/lib/api';
import { useChartColors } from '@/lib/theme';
import { HIST } from '@/constants/testIds';
import { cn } from '@/lib/utils';

// Ranges expressed as `hours` (float) — matches the real backend contract.
const RANGES = [
  { key: '1', label: '1H' },
  { key: '24', label: '24H' },
  { key: '168', label: '7D' },
  { key: '720', label: '30D' },
] as const;

const DOMAINS = [
  { key: 'battery', label: 'Battery voltage', unit: 'V', color: '#22d3ee', chart: 'line' as const, glow: 'teal' as const },
  { key: 'solar', label: 'Solar power', unit: 'W', color: '#a855f7', chart: 'area' as const, glow: 'purple' as const },
  { key: 'environment', label: 'Interior temperature', unit: '°C', color: '#f472b6', chart: 'line' as const, glow: undefined },
  { key: 'energy', label: 'Net energy', unit: 'W', color: '#38bdf8', chart: 'area' as const, glow: undefined },
] as const;

export function HistoryScreen() {
  const [hours, setHours] = useState<string>('24');
  const colors = useChartColors();

  return (
    <div data-testid={HIST.root} className="mx-auto max-w-[1500px] px-4 sm:px-6 lg:px-10 py-6 lg:py-10">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-ink-muted">History</div>
          <h1 className="text-3xl md:text-5xl font-semibold tracking-tight mt-1">Look <span className="text-aurora-teal">back</span>, plan ahead</h1>
          <div className="text-sm text-ink-muted mt-2">SQLite-backed samples · gaps are honest — a missing point stays missing.</div>
        </div>
        <div className="inline-flex bg-ink/[0.03] ring-1 ring-ink/10 rounded-full p-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              data-testid={HIST.range(r.label.toLowerCase())}
              type="button"
              onClick={() => setHours(r.key)}
              className={cn(
                'text-xs px-4 py-1.5 rounded-full transition',
                hours === r.key ? 'bg-aurora-teal text-navy-900 font-semibold' : 'text-ink-soft hover:text-ink',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4 lg:gap-6">
        {DOMAINS.map((d) => (
          <HistoryPanel key={d.key} domainKey={d.key} label={d.label} unit={d.unit} color={d.color} chart={d.chart} glow={d.glow} hours={hours} colors={colors} />
        ))}
      </div>
    </div>
  );
}

function HistoryPanel({
  domainKey, label, unit, color, chart, glow, hours, colors,
}: {
  domainKey: string; label: string; unit: string; color: string;
  chart: 'line' | 'area'; glow?: 'teal' | 'purple';
  hours: string; colors: ReturnType<typeof useChartColors>;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['history', domainKey, hours],
    queryFn: () => {
      const h = parseFloat(hours);
      // Suggested usage: max_points=500 for 7d/30d, omitted for 1h/24h.
      // Omitting returns everything; passing a value larger than the dataset
      // is a no-op — so `max_points` is safe to always send, but keeping the
      // omission for short ranges makes it obvious we want every point there.
      const maxPoints = h >= 168 ? 500 : undefined;
      return api.history(domainKey, h, maxPoints);
    },
  });

  const series = useMemo(() => (data?.series || []).map((s) => ({ ...s, t: fmtT(s.t, parseFloat(hours)) })), [data, hours]);
  const gradId = `hist-${domainKey}`;

  return (
    <GlassCard glow={glow} className="col-span-12 lg:col-span-6 p-6" data-testid={HIST.chart(domainKey)}>
      <CardHeader
        label={label}
        hint={unit}
        right={<StatusPill tone={glow === 'teal' ? 'teal' : glow === 'purple' ? 'purple' : 'slate'}>{domainKey.toUpperCase()}</StatusPill>}
      />
      <div className="h-[280px]">
        {isLoading ? (
          <div className="h-full grid place-items-center text-sm text-ink-muted">loading…</div>
        ) : series.length === 0 ? (
          <div className="h-full grid place-items-center text-sm text-ink-muted">no samples for this range yet</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {chart === 'line' ? (
              <LineChart data={series} margin={{ top: 10, right: 10, left: -18, bottom: 0 }}>
                <CartesianGrid stroke={colors.grid} vertical={false} />
                <XAxis dataKey="t" tick={{ fill: colors.axis, fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={40} />
                <YAxis tick={{ fill: colors.axis, fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: colors.tooltipBg, border: `1px solid ${colors.tooltipBorder}`, borderRadius: 12, color: colors.tooltipColor }} labelStyle={{ color: colors.tooltipColor }} />
                <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2.2} dot={false} isAnimationActive={false} connectNulls={false} />
              </LineChart>
            ) : (
              <AreaChart data={series} margin={{ top: 10, right: 10, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.45} />
                    <stop offset="100%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={colors.grid} vertical={false} />
                <XAxis dataKey="t" tick={{ fill: colors.axis, fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={40} />
                <YAxis tick={{ fill: colors.axis, fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: colors.tooltipBg, border: `1px solid ${colors.tooltipBorder}`, borderRadius: 12, color: colors.tooltipColor }} labelStyle={{ color: colors.tooltipColor }} />
                <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#${gradId})`} isAnimationActive={false} connectNulls={false} />
              </AreaChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
    </GlassCard>
  );
}

function fmtT(t: number, hours: number): string {
  const d = new Date(t * 1000);
  if (hours <= 24) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
