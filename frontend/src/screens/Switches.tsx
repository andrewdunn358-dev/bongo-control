import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Power, PlugZap, Unplug } from 'lucide-react';
import { GlassCard } from '@/components/primitives/GlassCard';
import { api, ApiError } from '@/lib/api';
import { SWITCH } from '@/constants/testIds';
import { fmtUnixTime } from '@/lib/format';
import { pinLabel } from '@/lib/pins';

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

  // Marks a channel as wired to a real circuit, or not. A spare stays
  // fully togglable here (that's how you bench-test one before wiring
  // it) - the flag only controls whether Ron offers it and whether
  // voice will match its name.
  const inUseMut = useMutation({
    mutationFn: ({ id, in_use }: { id: number; in_use: boolean }) => api.setRelayInUse(id, in_use),
    onSuccess: (_d, { in_use }) => {
      qc.invalidateQueries({ queryKey: ['relays'] });
      toast.success(in_use ? 'Marked as wired to a circuit' : 'Marked as a spare — Ron will stop offering it');
    },
    onError: () => toast.error('Could not update'),
  });

  const setMut = useMutation({
    mutationFn: ({ id, on }: { id: number; on: boolean }) => api.setRelay(id, on),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['relays'] }),
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) toast.error('Locked — unlock on the Camera screen first.');
      else toast.error('Relay update failed');
    },
  });

  const relays = (data?.channels || []).filter((r) => !roofChannelIds.has(r.id));

  return (
    <div data-testid={SWITCH.root} className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10 py-6 lg:py-10">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-ink-muted">Switches</div>
          <h1 className="text-3xl md:text-5xl font-semibold tracking-tight mt-1">Switches</h1>
          <div className="text-sm text-ink-muted mt-2">Four GPIO relays wired in parallel with the van&apos;s manual switches.</div>
        </div>
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
            className={`p-5 transition ${r.in_use ? '' : 'opacity-60'}`}
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
                {/* Physical header pin, not the BCM number the backend
                    stores - see lib/pins.ts. This is the number written
                    on the wiring diagrams and countable on the header. */}
                <div className="text-[11px] text-ink-faint mt-1 num">
                  {pinLabel(r.gpio)}
                  {!r.in_use && <span className="ml-2 text-ink-muted">· spare, no load wired</span>}
                </div>
              </div>
            </div>
            <div className="mt-4">
              <button
                type="button"
                aria-label={`Toggle ${r.name}`}
                onClick={() => setMut.mutate({ id: r.id, on: !r.commanded_on })}
                disabled={setMut.isPending}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed bg-ink/[0.06] ring-1 ring-inset ring-ink/15 hover:bg-ink/[0.1]"
              >
                <Power size={14} /> Toggle
              </button>
              <button
                type="button"
                onClick={() => inUseMut.mutate({ id: r.id, in_use: !r.in_use })}
                disabled={inUseMut.isPending}
                title={
                  r.in_use
                    ? 'Mark as a spare — keeps the toggle, but Ron and voice stop offering it'
                    : 'Mark as wired to a real circuit — Ron and voice start offering it again'
                }
                className="mt-2 w-full inline-flex items-center justify-center gap-1.5 rounded-xl py-1.5 text-[11px] text-ink-muted transition disabled:opacity-50 hover:text-ink"
              >
                {r.in_use ? <><Unplug size={12} /> Mark as spare</> : <><PlugZap size={12} /> Mark as wired</>}
              </button>
            </div>
          </GlassCard>
        ))}
      </div>
    </div>
  );
}
