import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Power, PowerOff } from 'lucide-react';
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

  // Roof relays are excluded below, not just guarded server-side - the
  // backend refuses to turn one ON via this screen's plain toggle
  // (see relays.py), but showing a toggle that always 409s on tap is
  // just a worse UI. The Roof screen's hold-to-run buttons are the
  // only place these two are meant to be driven from.
  const { data: roofData } = useQuery({
    queryKey: ['roof'],
    queryFn: api.roofStatus,
    refetchInterval: 8_000,
    retry: (count, e) => !(e instanceof ApiError && e.status === 401) && count < 2,
  });
  const roofChannelIds = new Set(
    [roofData?.up_channel, roofData?.down_channel, ...(roofData?.isolate_channels ?? [])].filter(
      (v): v is number => v != null,
    ),
  );

  // Three genuinely different empty states that all previously showed
  // the same "No relays reported" text: locked out (401), GPIO
  // unavailable on this machine, or simply nothing configured. Telling
  // them apart is the difference between an actionable message and a
  // confusing one.
  const isLocked = error instanceof ApiError && error.status === 401;

  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState('');

  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => api.renameRelay(id, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['relays'] });
      setEditingId(null);
    },
    onError: () => toast.error('Could not rename'),
  });

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

  const relays = (data?.channels || []).filter((r) => !roofChannelIds.has(r.id));

  return (
    <div data-testid={SWITCH.root} className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10 py-6 lg:py-10">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-ink-muted">Switches</div>
          <h1 className="text-3xl md:text-5xl font-semibold tracking-tight mt-1">Switches</h1>
          <div className="text-sm text-ink-muted mt-2">Four GPIO relays wired in parallel with the van&apos;s manual switches.</div>
          <div className="text-xs text-ink-faint mt-1 max-w-2xl">
            The tags below show what we last told each relay to do, not what&apos;s actually happening at the bulb — the
            physical wall switch affects real power too, and the app has no way to sense that. A light can be lit or
            dark independent of what&apos;s shown here.
          </div>
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

      {roofChannelIds.size > 0 && (
        <div className="text-xs text-ink-faint mb-6 -mt-3">
          Roof relays aren&apos;t listed here — hold-to-run only, on the <a href="/roof" className="text-aurora-teal underline">Roof</a> screen.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {isLoading && Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glass p-5 h-[112px] animate-pulse opacity-60" />
        ))}
        {!isLoading && relays.length === 0 && (
          <GlassCard className="col-span-full p-6 text-sm text-ink-muted">
            {isLocked ? (
              <>
                <span className="text-status-amber font-medium">Locked.</span> Relay control needs the app password.
                The unlock screen should appear automatically &mdash; if it doesn&apos;t, reload the app to sign in again.
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
                {editingId === r.id ? (
                  <input
                    value={draftName}
                    autoFocus
                    maxLength={48}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={() => (draftName.trim() ? renameMut.mutate({ id: r.id, name: draftName }) : setEditingId(null))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && draftName.trim()) renameMut.mutate({ id: r.id, name: draftName });
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    className="mt-1 w-full rounded-lg px-2 py-1 text-lg font-semibold bg-ink/[0.06] border border-aurora-teal/50 outline-none"
                  />
                ) : (
                  /* Click the name to rename. A separate edit button
                     would clutter a card whose primary action is a big
                     toggle - and "Relay 2" is self-evidently a
                     placeholder, so the affordance is discoverable. */
                  <button
                    type="button"
                    onClick={() => { setEditingId(r.id); setDraftName(r.name); }}
                    title="Click to rename"
                    className="text-lg font-semibold mt-1 truncate text-left hover:text-aurora-teal transition"
                  >
                    {r.name}
                  </button>
                )}
                <div className="text-[11px] text-ink-faint mt-1 num">GPIO {r.gpio}</div>
              </div>
              <StatusPill tone={r.commanded_on ? 'teal' : 'slate'}>
                {r.commanded_on ? 'CMD ON' : 'CMD OFF'}
              </StatusPill>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-sm text-ink-muted">{r.commanded_on ? 'Relay commanded on' : 'Relay commanded off'}</span>
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
    </div>
  );
}
