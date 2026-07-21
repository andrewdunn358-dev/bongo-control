import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Info, Power, PowerOff } from 'lucide-react';
import { GlassCard } from '@/components/primitives/GlassCard';
import { StatusPill } from '@/components/primitives/StatusPill';
import { api, ApiError } from '@/lib/api';
import { SWITCH } from '@/constants/testIds';
import { fmtUnixTime } from '@/lib/format';
import { cn } from '@/lib/utils';

export function Switches() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['relays'],
    queryFn: api.relays,
    refetchInterval: 8_000,
  });

  const setMut = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => api.setRelay(id, on),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['relays'] }),
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) toast.error('Locked — unlock on the Camera screen first.');
      else toast.error('Relay update failed');
    },
  });

  const allOff = useMutation({
    mutationFn: () => api.relaysAllOff(),
    onSuccess: () => { toast.success('All relays commanded off'); qc.invalidateQueries({ queryKey: ['relays'] }); },
    onError: () => toast.error('All-off failed'),
  });

  const relays = data?.relays || [];

  return (
    <div data-testid={SWITCH.root} className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10 py-6 lg:py-10">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-ink-muted">Switches</div>
          <h1 className="text-3xl md:text-5xl font-semibold tracking-tight mt-1">Relays — <span className="text-aurora-teal">commanded</span> state</h1>
          <div className="text-sm text-ink-muted mt-2">Four GPIO relays wired in parallel with the van&apos;s manual switches.</div>
        </div>
        <button
          type="button"
          data-testid={SWITCH.allOff}
          onClick={() => allOff.mutate()}
          disabled={allOff.isPending}
          className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm bg-red-500/10 ring-1 ring-inset ring-red-400/40 text-status-red hover:bg-red-500/15 disabled:opacity-50"
        >
          <PowerOff size={14} /> {allOff.isPending ? 'Sending…' : 'All off'}
        </button>
      </div>

      <GlassCard className="p-4 mb-6" data-testid={SWITCH.caveat}>
        <div className="flex gap-3 items-start">
          <Info size={16} className="text-status-amber mt-0.5 shrink-0" />
          <div className="text-sm text-ink-soft leading-relaxed">
            These labels read <span className="num">commanded on</span> — not <em>on</em>. The
            relays sit in parallel with physical switches on the wall, so the app knows what it
            told the relay to do, but not whether the circuit is actually live. Treat the state
            below as an intent, not a measurement.
          </div>
        </div>
      </GlassCard>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {isLoading && Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glass p-5 h-[112px] animate-pulse opacity-60" />
        ))}
        {!isLoading && relays.length === 0 && (
          <GlassCard className="col-span-full p-6 text-sm text-ink-muted">
            No relays reported. If a password is set, unlock on the <a href="/camera" className="text-aurora-teal underline">Camera</a> page first &mdash; relays require the same token.
          </GlassCard>
        )}
        {relays.map((r) => (
          <GlassCard
            key={r.id}
            className={cn('p-5 transition', r.commanded_on ? 'glow-teal' : '')}
            data-testid={SWITCH.relay(r.id)}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-[0.18em] text-ink-muted">Relay {r.id}</div>
                <div className="text-lg font-semibold mt-1 truncate">{r.label}</div>
                <div className="text-[11px] text-ink-faint mt-1">last change {fmtUnixTime(r.last_changed ?? null)}</div>
              </div>
              <StatusPill tone={r.commanded_on ? 'teal' : 'slate'}>
                {r.commanded_on ? 'COMMANDED ON' : 'COMMANDED OFF'}
              </StatusPill>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setMut.mutate({ id: r.id, on: true })}
                disabled={setMut.isPending || r.commanded_on}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-full px-3 py-2 text-sm bg-emerald-500/15 ring-1 ring-inset ring-emerald-400/40 text-status-green hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Power size={14} /> On
              </button>
              <button
                type="button"
                onClick={() => setMut.mutate({ id: r.id, on: false })}
                disabled={setMut.isPending || !r.commanded_on}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-full px-3 py-2 text-sm bg-ink/[0.05] ring-1 ring-inset ring-ink/15 text-ink-soft hover:bg-ink/[0.1] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <PowerOff size={14} /> Off
              </button>
            </div>
          </GlassCard>
        ))}
      </div>

      <div className="mt-6 text-[11px] text-ink-faint">
        Backend endpoint: <span className="num">POST /api/relays/&#123;id&#125;/set</span>. Auth is enforced by the backend when a password is set. If a 401 lands here, unlock on the <a href="/camera" className="text-aurora-teal underline">Camera</a> page first.
      </div>
    </div>
  );
}
