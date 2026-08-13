import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, AlertTriangle, XCircle, Sparkles, ListChecks, Gauge, Radio } from 'lucide-react';
import { Link } from 'react-router-dom';
import { GlassCard, CardHeader } from '@/components/primitives/GlassCard';
import { StatusPill } from '@/components/primitives/StatusPill';
import { api } from '@/lib/api';
import { DASH } from '@/lib/format';
import { OVERVIEW } from '@/constants/testIds';

// Matches Home.tsx's own STATUS_META - kept as a small, separate copy
// rather than a shared import. Three entries, unlikely to drift, and
// not worth a shared module for something this small.
const STATUS_META = {
  green: { tone: 'green' as const, label: 'GREEN', icon: ShieldCheck },
  amber: { tone: 'amber' as const, label: 'AMBER', icon: AlertTriangle },
  red: { tone: 'red' as const, label: 'RED', icon: XCircle },
};

const SEVERITY_META: Record<string, { tone: 'green' | 'amber' | 'red' | 'slate'; label: string }> = {
  ok: { tone: 'green', label: 'OK' },
  warning: { tone: 'amber', label: 'WARNING' },
  critical: { tone: 'red', label: 'CRITICAL' },
  unknown: { tone: 'slate', label: 'NO DATA' },
};

function timeAgo(unixSeconds: number): string {
  const diffSec = Math.max(0, Date.now() / 1000 - unixSeconds);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  return `${Math.floor(diffSec / 3600)}h ago`;
}

export function Overview() {
  // Same 30s cadence as Home's own mission-brief query - this page and
  // Home's summary card should never meaningfully disagree, since
  // they're reading the exact same backend computation, not two
  // separate ones.
  const { data: brief, isLoading } = useQuery({
    queryKey: ['mission-brief'],
    queryFn: api.missionBrief,
    refetchInterval: 30_000,
  });

  const meta = STATUS_META[brief?.status ?? 'green'];
  const Icon = meta.icon;
  const empty = !brief && !isLoading;

  return (
    <div data-testid={OVERVIEW.root} className="mx-auto max-w-[1500px] px-4 sm:px-6 lg:px-10 py-6 lg:py-10">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-ink-muted">Overview</div>
          <h1 className="text-3xl md:text-5xl font-semibold tracking-tight mt-1">
            The whole <span className="text-aurora-teal">picture</span>
          </h1>
          <div className="text-sm text-ink-muted mt-2 max-w-2xl">
            Every signal the app is currently tracking, combined into one status — the same computation behind the
            Mission Brief card on Home, shown in full here instead of just the headline. Worst signal wins: one
            critical reading pulls the whole status to red, however good everything else looks.
          </div>
        </div>
        <StatusPill tone={brief ? meta.tone : 'slate'} data-testid={OVERVIEW.statusPill}>
          {brief ? meta.label : isLoading ? 'LOADING…' : 'NO DATA'}
        </StatusPill>
      </div>

      {empty ? (
        <GlassCard className="p-8 text-center text-sm text-ink-muted">
          No mission brief computed yet — check back shortly once telemetry starts arriving.
        </GlassCard>
      ) : (
        <div className="grid grid-cols-12 gap-4 lg:gap-6">
          {/* Hero status card */}
          <GlassCard glow={meta.tone === 'red' ? undefined : 'teal'} className="col-span-12 p-6">
            <div className="flex flex-col sm:flex-row sm:items-start gap-4">
              <div className="flex items-start gap-4 min-w-0 flex-1">
                <div
                  className={
                    'shrink-0 h-14 w-14 rounded-2xl grid place-items-center ring-1 ' +
                    (meta.tone === 'green'
                      ? 'bg-status-green/10 ring-status-green/30'
                      : meta.tone === 'amber'
                        ? 'bg-status-amber/10 ring-status-amber/30'
                        : 'bg-status-red/10 ring-status-red/30')
                  }
                >
                  <Icon
                    size={26}
                    className={meta.tone === 'green' ? 'text-status-green' : meta.tone === 'amber' ? 'text-status-amber' : 'text-status-red'}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-lg md:text-xl font-semibold">{brief?.summary ?? DASH}</div>
                  <div className="text-xs text-ink-faint mt-1">
                    {brief ? `Computed ${timeAgo(brief.computed_at)}` : DASH} · {brief?.signals.length ?? 0} signal
                    {brief?.signals.length === 1 ? '' : 's'} tracked
                  </div>
                </div>
              </div>
              <Link
                to="/chat"
                state={{
                  // Overview -> Chat handoff: previously this just linked
                  // to an empty chat, which implied clicking it would
                  // actually ask something rather than just open the
                  // app. Ron already has the full mission brief in his
                  // own context regardless of exact phrasing (see
                  // ai_chat_service.py's _describe_mission_brief), so
                  // this only needs to read as a natural question
                  // referencing what's actually on screen right now -
                  // Chat.tsx picks up location.state.autoAsk and sends
                  // it once, automatically, on arrival.
                  autoAsk: brief
                    ? `My mission brief says: "${brief.summary}" - what's going on, and is there anything I should actually do about it?`
                    : undefined,
                }}
                className="self-start shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium bg-ink/[0.04] ring-1 ring-ink/10 text-ink-soft hover:bg-ink/[0.08]"
              >
                <Sparkles size={12} className="text-aurora-purple" /> Ask Ron about this
              </Link>
            </div>
          </GlassCard>

          {/* Recommendations */}
          <GlassCard className="col-span-12 xl:col-span-6 p-6" data-testid={OVERVIEW.recommendations}>
            <CardHeader label="Recommendations" hint="what's actually worth doing something about" right={<ListChecks size={16} className="text-aurora-teal" />} />
            {!brief?.recommendations.length ? (
              <div className="text-sm text-ink-faint mt-2">Nothing needs attention right now.</div>
            ) : (
              <ul className="mt-2 space-y-2">
                {brief.recommendations.map((rec, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <AlertTriangle size={14} className="text-status-amber shrink-0 mt-0.5" />
                    <span className="min-w-0">{rec}</span>
                  </li>
                ))}
              </ul>
            )}
          </GlassCard>

          {/* Predictions */}
          <GlassCard className="col-span-12 xl:col-span-6 p-6" data-testid={OVERVIEW.predictions}>
            <CardHeader label="Predictions" hint="what the app is estimating from current data" right={<Gauge size={16} className="text-aurora-teal" />} />
            {!brief?.predictions.length ? (
              <div className="text-sm text-ink-faint mt-2">No predictions available yet.</div>
            ) : (
              <div className="mt-2 space-y-3">
                {brief.predictions.map((pred) => (
                  <div
                    key={pred.key}
                    className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 sm:gap-3 text-sm border-b border-ink/5 pb-2 last:border-0 last:pb-0"
                  >
                    <span className="text-ink-soft">{pred.label}</span>
                    <span className="sm:text-right">
                      <span className="num font-medium">{pred.value == null ? DASH : `${pred.value}${pred.unit ? ` ${pred.unit}` : ''}`}</span>
                      {pred.confidence && <div className="text-[11px] text-ink-faint mt-0.5 sm:max-w-[220px]">{pred.confidence}</div>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>

          {/* Every underlying signal - the "why" behind the status */}
          <GlassCard className="col-span-12 p-6" data-testid={OVERVIEW.signals}>
            <CardHeader label="All signals" hint="every domain contributing to the status above, not just the ones flagging something" right={<Radio size={16} className="text-aurora-teal" />} />
            {!brief?.signals.length ? (
              <div className="text-sm text-ink-faint mt-2">No signals reporting yet.</div>
            ) : (
              <div className="mt-2 divide-y divide-ink/5">
                {brief.signals.map((sig, i) => {
                  const sevMeta = SEVERITY_META[sig.severity] ?? { tone: 'slate' as const, label: sig.severity.toUpperCase() || 'UNKNOWN' };
                  return (
                    // Below sm: the pill + fixed-width source label alone
                    // could eat most of a phone's screen width, forcing
                    // the message into a ~130px sliver that wrapped one
                    // word per line - a real layout bug, not just visual
                    // density. Stack pill+source above the message on
                    // narrow screens; row layout only from sm: up, same
                    // pattern as the hero card and Predictions above.
                    <div key={i} className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3 py-2.5 text-sm">
                      <div className="flex items-center gap-3">
                        <StatusPill tone={sevMeta.tone} className="shrink-0">{sevMeta.label}</StatusPill>
                        <span className="text-ink-faint text-xs uppercase tracking-wide sm:w-28 shrink-0 sm:truncate" title={sig.source}>{sig.source}</span>
                      </div>
                      <span className="flex-1 min-w-0">{sig.message}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </GlassCard>
        </div>
      )}
    </div>
  );
}
