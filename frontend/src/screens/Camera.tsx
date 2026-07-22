import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Camera as CameraIcon, Lock, RefreshCw, ImageDown, MoreVertical, Trash2 } from 'lucide-react';
import { GlassCard, CardHeader } from '@/components/primitives/GlassCard';
import { StatusPill } from '@/components/primitives/StatusPill';
import { api, getToken, clearToken } from '@/lib/api';
import { CAM } from '@/constants/testIds';
import type { CameraSnapshot } from '@/lib/types';

/**
 * Camera view.
 *
 * Uses SNAPSHOT POLLING (~1.5s), not the MJPEG stream. multipart/x-mixed-replace
 * works on desktop but fails silently on mobile; snapshot polling is a plain
 * HTTP GET repeated and has no such issues.
 *
 * Each frame is preloaded in a background Image() so the visible <img> only
 * swaps once the new bytes are decoded — otherwise it flashes blank.
 *
 * Unlock is handled app-wide by AppGate, so this screen only renders once a
 * token exists; it never has to show a "locked" state itself.
 *
 * The "Snapshot" button persists a frame to the Pi (see camera_service /
 * snapshot_store on the backend). Saved snapshots survive a reload and are
 * listed alongside, each with a kebab menu to delete it.
 */
const POLL_MS = 1500;

export function CameraView() {
  const qc = useQueryClient();
  const [token, setTok] = useState<string>(getToken());
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const authStatus = useQuery({ queryKey: ['auth-status'], queryFn: api.authStatus });
  const unlocked = !!token || authStatus.data?.required === false;

  const snapshots = useQuery({
    queryKey: ['camera-snapshots'],
    queryFn: api.cameraSnapshots,
    enabled: unlocked,
  });
  const snaps = snapshots.data?.snapshots ?? [];

  const save = useMutation({
    mutationFn: api.saveSnapshot,
    onSuccess: () => {
      toast.success('Snapshot saved');
      qc.invalidateQueries({ queryKey: ['camera-snapshots'] });
    },
    onError: () => toast.error('Could not save snapshot'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteSnapshot(id),
    onSuccess: () => {
      toast('Snapshot deleted');
      qc.invalidateQueries({ queryKey: ['camera-snapshots'] });
    },
    onError: () => toast.error('Could not delete snapshot'),
  });

  // Poll snapshots (live view)
  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;

    const tick = () => {
      const url = api.cameraSnapshotUrl(Date.now());
      const preload = new Image();
      preload.onload = () => { if (!cancelled) setCurrentUrl(url); };
      preload.onerror = () => { /* ignore; keep last good frame */ };
      preload.src = url;
    };
    tick();
    const iv = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(iv); };
  }, [unlocked, token]);

  const lock = () => {
    clearToken();
    setTok('');
    setCurrentUrl(null);
    toast('Camera locked');
  };

  const refreshFrame = () => {
    const url = api.cameraSnapshotUrl(Date.now());
    const i = new Image();
    i.onload = () => setCurrentUrl(url);
    i.src = url;
  };

  // Live-view controls, shared by the desktop overlay and the mobile
  // control bar so there's exactly one definition of each button.
  const controls = (variant: 'overlay' | 'bar') => {
    const refreshCls =
      variant === 'overlay'
        ? 'bg-black/40 ring-1 ring-white/15 text-white hover:bg-black/60 backdrop-blur'
        : 'bg-ink/[0.04] ring-1 ring-ink/10 text-ink-soft hover:bg-ink/[0.08]';
    return (
      <>
        <button
          type="button"
          onClick={refreshFrame}
          disabled={!currentUrl}
          className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm disabled:opacity-40 ${refreshCls}`}
        >
          <RefreshCw size={14} /> Refresh
        </button>
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={!currentUrl || save.isPending}
          className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm bg-aurora-teal text-navy-900 font-semibold hover:brightness-110 disabled:opacity-40"
        >
          <CameraIcon size={14} /> {save.isPending ? 'Saving…' : 'Snapshot'}
        </button>
      </>
    );
  };

  return (
    <div data-testid={CAM.root} className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 py-6 lg:py-10">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-ink-muted">Camera</div>
          <h1 className="text-3xl md:text-5xl font-semibold tracking-tight mt-1">USB <span className="text-aurora-teal">webcam</span></h1>
          <div className="text-sm text-ink-muted mt-2">Snapshot polling every {POLL_MS} ms — reliable on both tablet and phone.</div>
        </div>
        {unlocked && (
          <div className="flex items-center gap-2">
            <StatusPill tone="red" data-testid={CAM.liveBadge}>LIVE</StatusPill>
            {authStatus.data?.required && (
              <button
                type="button"
                onClick={lock}
                data-testid={CAM.lockBtn}
                className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm bg-ink/[0.04] ring-1 ring-ink/10 text-ink-soft hover:bg-ink/[0.08]"
              >
                <Lock size={14} /> Lock
              </button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-12 gap-4 lg:gap-6">
        <GlassCard className="col-span-12 lg:col-span-9 p-0 overflow-hidden" data-testid={CAM.frame}>
          <div className="relative bg-black/60 aspect-video">
            {currentUrl ? (
              <img ref={imgRef} src={currentUrl} alt="Live camera" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full grid place-items-center text-ink-muted text-sm">Waiting for first frame…</div>
            )}
            {/* Desktop only: floating controls over the video. On mobile
                these sat on top of the image and got in the way, so they
                move to the control bar below the frame instead. */}
            <div className="absolute bottom-4 right-4 hidden md:flex gap-2">
              {controls('overlay')}
            </div>
          </div>
          {/* Mobile only: controls live under the frame, never on it. */}
          <div className="flex md:hidden items-center justify-end gap-2 p-3 border-t border-ink/5">
            {controls('bar')}
          </div>
        </GlassCard>

        <GlassCard className="col-span-12 lg:col-span-3 p-4">
          <CardHeader label="Snapshots" hint={`${snaps.length} saved on the Pi`} />
          {snaps.length === 0 && (
            <div className="rounded-xl bg-ink/[0.03] ring-1 ring-ink/10 p-6 text-center text-sm text-ink-muted flex flex-col items-center gap-2">
              <ImageDown size={22} className="text-ink-faint" />
              No snapshots yet — tap the shutter.
            </div>
          )}
          <ul className="space-y-3 max-h-[560px] overflow-auto scrollbar-hide">
            {snaps.map((s) => (
              <SnapshotItem key={s.id} snap={s} onDelete={() => remove.mutate(s.id)} deleting={remove.isPending} />
            ))}
          </ul>
        </GlassCard>
      </div>
    </div>
  );
}

function SnapshotItem({ snap, onDelete, deleting }: { snap: CameraSnapshot; onDelete: () => void; deleting: boolean }) {
  const [open, setOpen] = useState(false);
  const at = new Date(snap.at * 1000).toLocaleString();

  return (
    <li className="relative rounded-xl overflow-hidden ring-1 ring-ink/10 bg-black/40">
      <img src={api.cameraSnapshotFileUrl(snap.id)} alt={`snapshot ${at}`} className="w-full aspect-video object-cover" />
      <div className="flex items-center justify-between px-3 py-2">
        <div className="text-[11px] text-ink-muted num">{at}</div>
        {/* Kebab menu — delete a saved snapshot. */}
        <button
          type="button"
          aria-label="Snapshot actions"
          onClick={() => setOpen((v) => !v)}
          className="text-ink-muted hover:text-ink rounded-lg p-1 hover:bg-ink/10"
        >
          <MoreVertical size={16} />
        </button>
      </div>
      {open && (
        <>
          {/* Click-away backdrop. */}
          <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute bottom-10 right-2 z-50 min-w-[120px] rounded-xl bg-navy-800 ring-1 ring-white/15 shadow-xl shadow-black/60 py-1 animate-fade-in">
            <button
              type="button"
              disabled={deleting}
              onClick={() => { setOpen(false); onDelete(); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-status-red hover:bg-white/5 disabled:opacity-40"
            >
              <Trash2 size={14} /> Delete
            </button>
          </div>
        </>
      )}
    </li>
  );
}
