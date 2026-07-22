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
  const { data, isLoading, error } = useQuery({
    queryKey: ['relays'],
    queryFn: api.relays,
    refetchInterval: 8_000,
    // Don't retry a 401 - it isn't a transient failure, it means the
    // app is locked and retrying will never help.
    retry: (count, e) => !(e instanceof ApiError && e.status === 401) && count < 2,
  });

  // Three genuinely different empty states that all previously showed
  // the same "No relays reported" text: locked out (401), GPIO
  // unavailable on this machine, or simply nothing configured. Telling
  // them apart is the difference between an actionable message and a
  // confusing one.
  const isLocked = error instanceof ApiError && error.status === 401;

  const setMut = useMutation({
    mutationFn: ({ id, on }: { id: number; on: boolean }) => api.setRelay(id, on),
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

  const relays = data?.channels || [];

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
            {isLocked ? (
              <>
                <span className="text-status-amber font-medium">Locked.</span> Relay control needs the app password.
                Unlock on the <a href="/camera" className="text-aurora-teal underline">Camera</a> page &mdash; it uses
                the same token, and it&apos;s only asked for once per device.
              </>
            ) : data && !data.available ? (
              <>
                Relay control unavailable{data.reason ? <> &mdash; {data.reason}</> : null}.
              </>
            ) : (
              <>No relays configured.</>
            )}
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
                <div className="text-lg font-semibold mt-1 truncate">{r.name}</div>
                <div className="text-[11px] text-ink-faint mt-1 num">GPIO {r.gpio}</div>
              </div>
              <StatusPill tone={r.commanded_on ? 'teal' : 'slate'}>
                {r.commanded_on ? 'COMMANDED ON' : 'COMMANDED OFF'}
              </StatusPill>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-sm text-ink-muted">{r.commanded_on ? 'Powered on' : 'Tap to switch on'}</span>
              <button
                type="button"
                role="switch"
                aria-checked={r.commanded_on}
                aria-label={`Toggle ${r.name}`}
                onClick={() => setMut.mutate({ id: r.id, on: !r.commanded_on })}
                disabled={setMut.isPending}
                className={cn(
                  'relative h-9 w-16 rounded-full transition disabled:opacity-50 disabled:cursor-not-allowed',
                  r.commanded_on
                    ? 'bg-aurora-teal/30 ring-1 ring-inset ring-aurora-teal/60 shadow-[0_0_18px_rgba(34,211,238,0.35)]'
                    : 'bg-ink/[0.06] ring-1 ring-inset ring-ink/15',
                )}
              >
                <span
                  className={cn(
                    'absolute top-1 h-7 w-7 rounded-full grid place-items-center transition-all duration-200',
                    r.commanded_on ? 'left-[calc(100%-2rem)] bg-aurora-teal text-navy-900' : 'left-1 bg-ink-faint/70 text-navy-900',
                  )}
                >
                  {r.commanded_on ? <Power size={13} /> : <PowerOff size={13} />}
                </span>
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
