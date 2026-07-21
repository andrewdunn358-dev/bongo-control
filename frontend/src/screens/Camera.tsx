import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Camera as CameraIcon, Lock, RefreshCw, ImageDown } from 'lucide-react';
import { GlassCard, CardHeader } from '@/components/primitives/GlassCard';
import { StatusPill } from '@/components/primitives/StatusPill';
import { api, getToken, setToken, clearToken } from '@/lib/api';
import { CAM } from '@/constants/testIds';

/**
 * Camera view.
 *
 * Uses SNAPSHOT POLLING (~1.5s), not the MJPEG stream. multipart/x-mixed-replace
 * works on desktop but fails silently on mobile; snapshot polling is a plain
 * HTTP GET repeated and has no such issues.
 *
 * Each frame is preloaded in a background Image() so the visible <img> only
 * swaps once the new bytes are decoded — otherwise it flashes blank.
 */
const POLL_MS = 1500;

export function CameraView() {
  const [token, setTok] = useState<string>(getToken());
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [snaps, setSnaps] = useState<{ url: string; at: string }[]>([]);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const authStatus = useQuery({ queryKey: ['auth-status'], queryFn: api.authStatus });
  const unlocked = !!token || authStatus.data?.required === false;

  // Poll snapshots
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

  const unlock = async () => {
    setBusy(true);
    try {
      const r = await api.unlock(password);
      setToken(r.token);
      setTok(r.token);
      toast.success('Camera unlocked');
      setPassword('');
    } catch {
      toast.error('Wrong password.');
    } finally {
      setBusy(false);
    }
  };

  const lock = () => {
    clearToken();
    setTok('');
    setCurrentUrl(null);
    setSnaps([]);
    toast('Camera locked');
  };

  const snapshot = () => {
    if (!currentUrl) return;
    setSnaps((s) => [{ url: currentUrl, at: new Date().toLocaleTimeString() }, ...s].slice(0, 8));
    toast.success('Snapshot captured');
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

      {!unlocked ? (
        <GlassCard glow="purple" className="p-8 max-w-md mx-auto" data-testid={CAM.gate}>
          <div className="flex flex-col items-center text-center">
            <div className="h-16 w-16 rounded-2xl grid place-items-center bg-aurora-purple/15 ring-1 ring-aurora-purple/40 text-aurora-purple">
              <Lock size={26} />
            </div>
            <h2 className="text-xl font-semibold mt-4">Camera is locked</h2>
            <p className="text-sm text-ink-muted mt-1">Enter the shared password.</p>
            <div className="mt-6 w-full">
              <input
                type="password"
                data-testid={CAM.passwordInput}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && unlock()}
                placeholder="Password"
                className="w-full rounded-xl bg-ink/[0.04] ring-1 ring-ink/10 focus:ring-aurora-teal/60 outline-none px-4 py-3 num"
              />
              <button
                type="button"
                data-testid={CAM.unlockBtn}
                onClick={unlock}
                disabled={busy || !password}
                className="mt-3 w-full rounded-xl bg-gradient-to-r from-aurora-teal to-aurora-purple text-navy-900 font-semibold py-3 disabled:opacity-40 hover:brightness-110"
              >
                {busy ? 'Verifying…' : 'Unlock camera'}
              </button>
            </div>
          </div>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-12 gap-4 lg:gap-6">
          <GlassCard className="col-span-12 lg:col-span-9 p-0 overflow-hidden" data-testid={CAM.frame}>
            <div className="relative bg-black/60 aspect-video">
              {currentUrl ? (
                <img ref={imgRef} src={currentUrl} alt="Live camera" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full grid place-items-center text-ink-muted text-sm">Waiting for first frame…</div>
              )}
              <div className="absolute bottom-4 right-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => { if (currentUrl) { const url = api.cameraSnapshotUrl(Date.now()); const i = new Image(); i.onload = () => setCurrentUrl(url); i.src = url; } }}
                  className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm bg-black/40 ring-1 ring-white/15 text-white hover:bg-black/60 backdrop-blur"
                >
                  <RefreshCw size={14} /> Refresh
                </button>
                <button
                  type="button"
                  onClick={snapshot}
                  disabled={!currentUrl}
                  className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm bg-aurora-teal text-navy-900 font-semibold hover:brightness-110 disabled:opacity-40"
                >
                  <CameraIcon size={14} /> Snapshot
                </button>
              </div>
            </div>
          </GlassCard>

          <GlassCard className="col-span-12 lg:col-span-3 p-4">
            <CardHeader label="Snapshots" hint={`${snaps.length}/8 recent`} />
            {snaps.length === 0 && (
              <div className="rounded-xl bg-ink/[0.03] ring-1 ring-ink/10 p-6 text-center text-sm text-ink-muted flex flex-col items-center gap-2">
                <ImageDown size={22} className="text-ink-faint" />
                No snapshots yet — tap the shutter.
              </div>
            )}
            <ul className="space-y-3">
              {snaps.map((s, i) => (
                <li key={i} className="rounded-xl overflow-hidden ring-1 ring-ink/10 bg-black/40">
                  <img src={s.url} alt={`snap ${s.at}`} className="w-full aspect-video object-cover" />
                  <div className="px-3 py-2 text-[11px] text-ink-muted num">{s.at}</div>
                </li>
              ))}
            </ul>
          </GlassCard>
        </div>
      )}
    </div>
  );
}
