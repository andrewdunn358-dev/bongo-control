import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Power, PlugZap, Unplug, Shield } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { SWITCH } from '@/constants/testIds';
import { pinLabel } from '@/lib/pins';
import './switches.css';

export function Switches() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['relays'],
    queryFn: api.relays,
    refetchInterval: 8000,
    retry: (count, e) => !(e instanceof ApiError && e.status === 401) && count < 2,
  });
  const { data: roofData } = useQuery({
    queryKey: ['roof'],
    queryFn: api.roofStatus,
    refetchInterval: 8000,
    retry: (count, e) => !(e instanceof ApiError && e.status === 401) && count < 2,
  });

  const roofIds = new Set(
    [roofData?.up_channel, roofData?.down_channel, ...(roofData?.isolate_channels ?? [])].filter(
      (v): v is number => v != null,
    ),
  );
  const locked = error instanceof ApiError && error.status === 401;
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState('');

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => api.renameRelay(id, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['relays'] });
      setEditingId(null);
    },
    onError: () => toast.error('Could not rename'),
  });

  const inUse = useMutation({
    mutationFn: ({ id, in_use }: { id: number; in_use: boolean }) => api.setRelayInUse(id, in_use),
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ['relays'] });
      toast.success(v.in_use ? 'Marked as wired to a circuit' : 'Marked as spare');
    },
    onError: () => toast.error('Could not update'),
  });

  const setMut = useMutation({
    mutationFn: ({ id, on }: { id: number; on: boolean }) => api.setRelay(id, on),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['relays'] }),
    onError: e => toast.error(e instanceof ApiError && e.status === 401 ? 'Locked — unlock the app again.' : 'Relay update failed'),
  });

  const relays = (data?.channels || []).filter(r => !roofIds.has(r.id));

  return (
    <div data-testid={SWITCH.root} className="sw-page">
      <header className="sw-heading">
        <div>
          <span className="sw-kicker">VANOS · HARDWARE CONTROL</span>
          <h1>Switch <em>deck</em></h1>
          <p>Send a toggle command to the configured GPIO relays.</p>
        </div>
        <div className="sw-authority"><Shield size={16} /> PHYSICAL SWITCHES REMAIN AUTHORITATIVE</div>
      </header>

      <div className="sw-note">
        These are <b>relay commands</b>, not load-status indicators. The physical wall switches are wired in parallel, so VanOS cannot know whether the appliance or circuit is actually on. Use <b>Toggle</b> to change the relay command; the app does not claim to know the resulting load state.
      </div>

      {isLoading && <div className="sw-grid">{Array.from({ length: 4 }).map((_, i) => <div className="sw-skeleton" key={i} />)}</div>}

      {!isLoading && relays.length === 0 && (
        <div className="sw-empty">
          <Power size={24} />
          <div>
            <strong>{locked ? 'Locked' : 'No relays available'}</strong>
            <p>{locked ? 'Relay control requires the app password.' : data && !data.available ? `Relay control unavailable${data.reason ? ` — ${data.reason}` : ''}.` : 'No relays configured.'}</p>
          </div>
        </div>
      )}

      <section className="sw-grid">
        {relays.map(r => (
          <article key={r.id} data-testid={SWITCH.relay(r.id)} className={`sw-card ${r.in_use ? '' : 'spare'}`}>
            <div className="sw-card-head">
              <div>
                <span className="sw-kicker">RELAY {r.id} · {pinLabel(r.gpio)}</span>
                {editingId === r.id ? (
                  <input
                    autoFocus
                    value={draftName}
                    maxLength={48}
                    onChange={e => setDraftName(e.target.value)}
                    onBlur={() => draftName.trim() ? rename.mutate({ id: r.id, name: draftName }) : setEditingId(null)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && draftName.trim()) rename.mutate({ id: r.id, name: draftName });
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                  />
                ) : (
                  <button className="sw-name" onClick={() => { setEditingId(r.id); setDraftName(r.name); }}>{r.name}</button>
                )}
              </div>
              <div className="sw-symbol"><Power size={18} /></div>
            </div>

            <div className="sw-command">
              <button
                type="button"
                className="sw-action sw-action-toggle"
                aria-label={`Toggle ${r.name}`}
                onClick={() => setMut.mutate({ id: r.id, on: !r.commanded_on })}
                disabled={setMut.isPending}
              >
                <Power size={30} />
                <strong>TOGGLE</strong>
                <span>Send command</span>
              </button>
            </div>

            <button
              type="button"
              className="sw-spare"
              onClick={() => inUse.mutate({ id: r.id, in_use: !r.in_use })}
              disabled={inUse.isPending}
            >
              {r.in_use ? <><Unplug size={13} /> Mark as spare</> : <><PlugZap size={13} /> Mark as wired</>}
            </button>
          </article>
        ))}
      </section>
    </div>
  );
}
