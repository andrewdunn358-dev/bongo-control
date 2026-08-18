import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Camera as CameraIcon, Lock, RefreshCw, ImageDown, MoreVertical, Trash2, Download, Video } from 'lucide-react';
import { GlassCard, CardHeader } from '@/components/primitives/GlassCard';
import { StatusPill } from '@/components/primitives/StatusPill';
import { api, getToken, clearToken } from '@/lib/api';
import { isDemo } from '@/lib/demo';
import { CAM } from '@/constants/testIds';
import type { CameraSnapshot } from '@/lib/types';

/**
 * Camera view.
 *
 * Uses SNAPSHOT POLLING (~1.5s) BY DEFAULT, with the MJPEG stream
 * available behind an opt-in toggle.
 *
 * The original note here said multipart/x-mixed-replace "works on desktop but
 * fails silently on mobile". That is now known to be too strong: Frankie ran
 * the stream successfully on his phone (17 Aug). Treat it as
 * browser-dependent rather than broken on mobile.
 *
 * Polling stays the DEFAULT anyway, for a reason that stands either way: a
 * repeated plain HTTP GET surfaces a real status code per frame, whereas a
 * stream that dies mid-connection can leave a frozen frame with no error at
 * all. Polling is the safe baseline; the stream is opted into for the one job
 * it is genuinely better at - focusing the lens, where a frame every 1.5s is
 * useless because you have moved past the sharp point before you see it.
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
// One failed poll can just be a transient blip - not worth alarming
// anyone over. A run of them in a row is the "stuck on Waiting for
// first frame with zero explanation" failure mode this is fixing.
const CONSECUTIVE_FAILURES_BEFORE_SHOWING_ERROR = 3;
/**
 * How long to wait after stopping the stream before snapshot polling
 * resumes. Reported: hitting "Stop stream" returned a 503.
 *
 * Not a real failure - a race. Stopping the stream unmounts the <img>,
 * which aborts the HTTP connection, and the backend only kills ffmpeg
 * once that abort propagates into the generator's finally block. Until
 * it does, ffmpeg still holds /dev/video0. Polling resumed on the same
 * tick as the toggle, so the very first snapshot hit a busy device and
 * the route turned that into a 503.
 *
 * Note the backend's device lock does NOT cover this: capture_snapshot()
 * takes it, but the stream's open() never does, so a snapshot can
 * acquire the lock happily and still find the device in use. Making the
 * stream hold the lock for its whole duration would fix it more deeply,
 * but would also block the Home screen's camera card for as long as a
 * stream is open - a worse trade than waiting a moment here.
 */
const STREAM_STOP_SETTLE_MS = 1500;

export function CameraView() {
  const qc = useQueryClient();
  const [token, setTok] = useState<string>(getToken());
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [frameError, setFrameError] = useState<string | null>(null);
  // Demo only: play cam.mp4 as a looping "live feed" if it's present,
  // otherwise fall back to the polled image (real photos / drawn scene).
  const [videoFailed, setVideoFailed] = useState(false);
  const showDemoVideo = isDemo && !videoFailed;
  // Opt-in continuous MJPEG stream, off by default.
  //
  // Snapshot polling stays the default for the reason documented at the
  // top of this file: multipart/x-mixed-replace works on desktop but
  // fails silently on mobile, and a live view that dies quietly is
  // worse than a slow one. But polling at POLL_MS is unusable for the
  // one job Frankie needed it for - adjusting the lens focus by hand,
  // where a frame every ~1.5s means you have already moved past the
  // sharp point before you can see it. So the stream is available as a
  // toggle, labelled with the caveat, rather than replacing the
  // default or being left out entirely.
  const [streamMode, setStreamMode] = useState(false);
  const [streamFailed, setStreamFailed] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  // Timestamp before which snapshot polling must not fire - set when a
  // stream is stopped, so ffmpeg has time to release the device.
  const [pollGateAt, setPollGateAt] = useState(0);
  const streaming = streamMode && !showDemoVideo;
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

  // Poll snapshots (live view).
  //
  // Uses fetch() + object URLs, NOT a plain <img src> being re-pointed
  // on a timer (the previous approach). That's a deliberate change:
  // an <img>'s onerror event carries no information at all - just
  // "it failed" - so every poll failure (wrong/expired token, camera
  // busy, network blip) was being silently swallowed and the UI sat on
  // "Waiting for first frame…" forever with zero explanation. Reported
  // case: works on the PC, permanently stuck on the phone - which
  // pointed straight at a per-device auth token, but that was
  // impossible to actually confirm with the old approach because
  // nothing surfaced what the real failure was. fetch() gives a real
  // HTTP status + body to show instead of a guess.
  useEffect(() => {
    // Also skipped while streaming: ffmpeg holds /dev/video0 for the
    // duration of the stream, so a concurrent snapshot poll would just
    // fight it for the device and fail every tick.
    if (!unlocked || showDemoVideo || streaming) return;
    let cancelled = false;
    let lastObjectUrl: string | null = null;
    let consecutiveFailures = 0;
    // Wait out any settle window left over from a just-stopped stream
    // before the first request, rather than firing one immediately and
    // relying on it failing quietly.
    const waitMs = Math.max(0, pollGateAt - Date.now());

    const tick = async () => {
      try {
        const res = await fetch(api.cameraSnapshotUrl(Date.now()));
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 150)}` : ''}`);
        }
        const blob = await res.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        setCurrentUrl(url);
        setFrameError(null);
        if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
        lastObjectUrl = url;
        consecutiveFailures = 0;
      } catch (e) {
        if (cancelled) return;
        consecutiveFailures += 1;
        if (consecutiveFailures >= CONSECUTIVE_FAILURES_BEFORE_SHOWING_ERROR) {
          setFrameError(e instanceof Error ? e.message : 'Could not load camera frame');
        }
      }
    };
    let iv: ReturnType<typeof setInterval> | undefined;
    const startTimer = setTimeout(() => {
      if (cancelled) return;
      tick();
      iv = setInterval(tick, POLL_MS);
    }, waitMs);
    return () => {
      cancelled = true;
      clearTimeout(startTimer);
      if (iv) clearInterval(iv);
      if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
    };
  }, [unlocked, token, showDemoVideo, streaming, pollGateAt]);

  const lock = () => {
    clearToken();
    setTok('');
    setCurrentUrl(null);
    setFrameError(null);
    toast('Camera locked');
  };

  const refreshFrame = async () => {
    try {
      const res = await fetch(api.cameraSnapshotUrl(Date.now()));
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const blob = await res.blob();
      setCurrentUrl(URL.createObjectURL(blob));
      setFrameError(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load camera frame');
    }
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
          <div className="text-sm text-ink-muted mt-2">
            {streaming
              ? 'Continuous stream — for focusing the lens. Uses more data and holds the camera open; some browsers may not support it.'
              : `Snapshot polling every ${POLL_MS} ms — reliable on both tablet and phone.`}
          </div>
          {streamFailed && streaming && (
            <div className="text-sm text-status-amber mt-1">
              {streamError
                ? `The stream did not load — ${streamError}`
                : 'The stream did not load. Checking why…'}
            </div>
          )}
        </div>
        {unlocked && (
          <div className="flex items-center gap-2">
            {!isDemo && (
              <button
                type="button"
                onClick={() => {
                  setStreamMode((v) => {
                    // Only gate when STOPPING - starting a stream has no
                    // device to wait for.
                    if (v) setPollGateAt(Date.now() + STREAM_STOP_SETTLE_MS);
                    return !v;
                  });
                  setStreamFailed(false);
                  setStreamError(null);
                  setFrameError(null);
                }}
                className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm ring-1 transition-colors ${
                  streaming
                    ? 'bg-aurora-teal/15 ring-aurora-teal/40 text-aurora-teal'
                    : 'bg-ink/[0.04] ring-ink/10 text-ink-soft hover:bg-ink/[0.08]'
                }`}
              >
                <Video size={14} /> {streaming ? 'Stop stream' : 'Live stream'}
              </button>
            )}
            <StatusPill tone={isDemo ? 'purple' : 'red'} data-testid={CAM.liveBadge}>{isDemo ? 'DEMO' : 'LIVE'}</StatusPill>
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
            {showDemoVideo ? (
              <video
                src="/cam.mp4"
                autoPlay
                loop
                muted
                playsInline
                className="w-full h-full object-cover"
                onError={() => setVideoFailed(true)}
              />
            ) : streaming ? (
              /* Plain <img> pointed at the multipart endpoint - that IS
                 how MJPEG is consumed in a browser; the img element
                 keeps swapping frames as parts arrive. onError only
                 fires if the connection is refused outright, which is
                 exactly the silent-failure caveat surfaced below. */
              <img
                src={api.cameraStreamUrl()}
                alt="Live camera stream"
                className="w-full h-full object-cover"
                onError={() => {
                  // An <img> onerror carries NO status and NO body, so
                  // the old handler could only guess - and it guessed
                  // "your browser doesn't support this", which was
                  // wrong and misleading the first time it fired for a
                  // real server-side 503. Re-request the same URL with
                  // fetch() purely to read the actual status and detail,
                  // so the UI reports what really happened.
                  setStreamFailed(true);
                  fetch(api.cameraStreamUrl())
                    .then(async (res) => {
                      if (res.ok) return; // transient - the img may recover
                      const body = await res.text().catch(() => '');
                      let detail = body.slice(0, 200);
                      try {
                        detail = JSON.parse(body).detail ?? detail;
                      } catch {
                        /* not JSON - use the raw text */
                      }
                      setStreamError(`${res.status} — ${detail}`);
                    })
                    .catch((e) => setStreamError(e instanceof Error ? e.message : 'Could not reach the camera'));
                }}
              />
            ) : currentUrl ? (
              <>
                <img ref={imgRef} src={currentUrl} alt="Live camera" className="w-full h-full object-cover" />
                {/* Last good frame stays up (same "don't blank out over a
                    transient blip" principle as before) but now says so,
                    rather than silently looking current when it isn't. */}
                {frameError && (
                  <div className="absolute top-3 left-3 right-3 rounded-lg bg-status-amber/90 text-navy-900 text-xs px-3 py-2 shadow-lg">
                    Showing last good frame — {frameError}
                  </div>
                )}
              </>
            ) : frameError ? (
              <div className="w-full h-full grid place-items-center text-center px-6 text-status-amber text-sm">{frameError}</div>
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
          <div className="absolute bottom-10 right-2 z-50 min-w-[140px] rounded-xl bg-navy-800 ring-1 ring-white/15 shadow-xl shadow-black/60 py-1 animate-fade-in">
            {/* The snapshot URL already carries ?token=, so a plain
                anchor works - no need to fetch the blob manually. The
                download attribute gives it a sensible filename rather
                than the bare snapshot id, and on mobile hands off to
                the OS share/save sheet. */}
            <a
              href={api.cameraSnapshotFileUrl(snap.id)}
              download={`bongo-${snap.id}.jpg`}
              onClick={() => setOpen(false)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-ink-soft hover:bg-white/5"
            >
              <Download size={14} /> Download
            </a>
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
