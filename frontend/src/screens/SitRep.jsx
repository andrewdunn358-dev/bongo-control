import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { RefreshCw, Clock, Flame, Sun, ShieldCheck, AlertTriangle, XCircle } from 'lucide-react';
import { endpoints } from '@/lib/api';
import { GlassCard, CardHeader } from '@/components/primitives/GlassCard';
import { StatusPill } from '@/components/primitives/StatusPill';
import { SIT } from '@/constants/testIds';

const STATUS_META = {
  green: { tone: 'green', label: 'GREEN · MISSION READY', icon: ShieldCheck, blurb: 'All systems healthy. Free to roam.' },
  amber: { tone: 'amber', label: 'AMBER · CONSERVE', icon: AlertTriangle, blurb: 'Keep an eye on power draw overnight.' },
  red: { tone: 'red', label: 'RED · CRITICAL', icon: XCircle, blurb: 'Shed loads immediately. Drive to charge if possible.' },
};

const BigCard = ({ icon: Icon, label, value, unit, sub, tone = 'teal', testId }) => (
  <GlassCard className="p-6" glow={tone === 'green' ? 'teal' : undefined} data-testid={testId}>
    <div className="flex items-start justify-between">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="h-9 w-9 grid place-items-center rounded-xl bg-white/5 ring-1 ring-inset ring-white/10 text-aurora-teal">
        <Icon size={18} />
      </div>
    </div>
    <div className="mt-4 flex items-baseline gap-1.5">
      <div className="num text-4xl font-semibold text-white">{value}</div>
      {unit && <div className="text-sm text-slate-400">{unit}</div>}
    </div>
    {sub && <div className="mt-2 text-xs text-slate-500">{sub}</div>}
  </GlassCard>
);

export const SitRep = () => {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['mission-brief'],
    queryFn: endpoints.missionBrief,
    refetchInterval: 15000,
  });

  const meta = STATUS_META[data?.status] || STATUS_META.green;
  const Icon = meta.icon;

  return (
    <div data-testid={SIT.root} className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 py-6 lg:py-10">
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Daily situation report</div>
          <h1 className="text-3xl md:text-5xl font-semibold text-white tracking-tight mt-1">
            SITREP <span className="text-aurora-purple">·</span> <span className="text-aurora-teal">{data?.status?.toUpperCase() || '—'}</span>
          </h1>
          <div className="text-sm text-slate-400 mt-2">{meta.blurb}</div>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          data-testid={SIT.refresh}
          className="hidden sm:inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm bg-white/[0.04] ring-1 ring-white/10 text-slate-200 hover:bg-white/[0.08] transition"
        >
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <GlassCard
          glow={meta.tone === 'red' ? undefined : meta.tone === 'amber' ? undefined : 'teal'}
          className="p-6 lg:p-8 mb-6"
          data-testid={SIT.statusBadge}
        >
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className={`h-14 w-14 rounded-2xl grid place-items-center ring-1 ring-inset
                ${meta.tone === 'green' ? 'bg-emerald-500/15 ring-emerald-400/30 text-status-green'
                : meta.tone === 'amber' ? 'bg-amber-500/15 ring-amber-400/30 text-status-amber'
                : 'bg-red-500/15 ring-red-400/40 text-status-red'}`}>
                <Icon size={26} />
              </div>
              <div>
                <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                <div className="text-white text-2xl md:text-3xl font-semibold tracking-tight mt-2">
                  {isLoading ? 'Assembling brief…' : plainEnglish(data)}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Generated {data ? new Date(data.generated_at).toLocaleTimeString() : '—'}
                </div>
              </div>
            </div>
          </div>
        </GlassCard>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-6 mb-6">
        <BigCard
          icon={Clock}
          label="Runtime remaining"
          value={data?.runtime_hours ?? '—'}
          unit="hours"
          sub="at current load, to 15% reserve"
          testId={SIT.runtimeCard}
        />
        <BigCard
          icon={Flame}
          label="Diesel heater"
          value={data?.heater_hours ?? '—'}
          unit="hours"
          sub="if run continuously from now"
          testId={SIT.heaterCard}
        />
        <BigCard
          icon={Sun}
          label="Solar tomorrow"
          value={data?.solar_forecast_kwh ?? '—'}
          unit="kWh"
          sub="forecast harvest"
          testId={SIT.solarCard}
        />
      </div>

      <GlassCard className="p-6" data-testid={SIT.recsList}>
        <CardHeader label="Recommendations" hint="plain-English guidance based on live data" />
        <ul className="space-y-3">
          {(data?.recommendations || []).map((r, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0
                ${meta.tone === 'green' ? 'bg-status-green shadow-[0_0_10px_rgba(16,185,129,0.9)]'
                  : meta.tone === 'amber' ? 'bg-status-amber shadow-[0_0_10px_rgba(245,158,11,0.9)]'
                  : 'bg-status-red shadow-[0_0_10px_rgba(239,68,68,0.9)]'}`} />
              <span className="text-sm md:text-base text-slate-200 leading-relaxed">{r}</span>
            </li>
          ))}
        </ul>
      </GlassCard>
    </div>
  );
};

function plainEnglish(data) {
  if (!data) return 'Loading mission brief…';
  const soc = data.highlights?.battery_soc;
  const solar = data.highlights?.solar_now_w;
  const load = data.highlights?.load_now_w;
  return `Battery at ${Math.round(soc)}%, pulling ${Math.round(load)}W with ${Math.round(solar)}W of solar coming in.`;
}
