import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { GlassCard, CardHeader } from '@/components/primitives/GlassCard';
import { api } from '@/lib/api';
import type { RelayEvent } from '@/lib/types';

const SOURCE_COLOR: Record<string, string> = {
  watchdog: 'bg-status-red/15 text-status-red ring-status-red/30',
};

function sourceClass(source: string): string {
  if (source in SOURCE_COLOR) return SOURCE_COLOR[source];
  if (source.startsWith('system:')) return 'bg-brand-orange/15 text-brand-orange ring-brand-orange/30';
  if (source.startsWith('roof:')) return 'bg-aurora-purple/15 text-aurora-purple ring-aurora-purple/30';
  return 'bg-aurora-teal/15 text-aurora-teal ring-aurora-teal/30';
}

function actionLabel(e: RelayEvent): string {
  if (e.action === 'hold_up' || e.action === 'hold_down') return `hold ${e.action.slice(5).toUpperCase()}`;
  if (e.action === 'release') return `release${e.detail ? ` · ${e.detail}` : ''}`;
  if (e.action === 'on' || e.action === 'off') return `toggle ${e.action.toUpperCase()}`;
  if (e.action === 'reset-off') return `reset · ${e.detail ?? 'off'}`;
  if (e.action === 'restored' || e.action === 'restored-off') return `restore${e.detail ? ` · ${e.detail}` : ''}`;
  return e.action;
}

function fmtWhen(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function RelayEventLog() {
  const q = useQuery({ queryKey: ['relay-events'], queryFn: () => api.relayEvents(), refetchInterval: 15000 });

  return (
    <GlassCard className="col-span-12 p-6">
      <CardHeader
        label="Relay log"
        hint="Durable audit trail — every relay/roof event and what caused it. Survives rebuilds, unlike the old Docker-only log."
        right={
          <button
            type="button"
            onClick={() => q.refetch()}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs bg-ink/[0.04] ring-1 ring-ink/10 text-ink-soft hover:bg-ink/[0.08]"
          >
            <RefreshCw size={12} className={q.isFetching ? 'animate-spin' : ''} /> Refresh
          </button>
        }
      />
      {q.isLoading && <div className="text-sm text-ink-muted">Loading…</div>}
      {q.isError && <div className="text-sm text-status-red">Couldn't load the relay log.</div>}
      {q.data && (q.data.events?.length ?? 0) === 0 && <div className="text-sm text-ink-muted">No relay events recorded yet.</div>}
      {q.data && q.data.events && q.data.events.length > 0 && (
        <div className="max-h-[420px] overflow-y-auto -mx-2">
          {q.data.events.map((e) => (
            <div key={e.id} className="flex items-center gap-3 px-2 py-2 text-sm border-b border-white/5 last:border-0">
              <div className="w-36 shrink-0 text-[11px] text-ink-faint num">{fmtWhen(e.timestamp)}</div>
              <div className="w-40 shrink-0 font-medium truncate">{e.channel_name}</div>
              <div className="flex-1 text-ink-soft truncate">{actionLabel(e)}</div>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-medium ring-1 ${sourceClass(e.source)}`}>
                {e.source}
              </span>
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}
