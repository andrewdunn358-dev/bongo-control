import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Camera as CameraIcon, Lock, RefreshCw, ImageDown } from 'lucide-react';
import { endpoints, getToken, setToken, clearToken } from '@/lib/api';
import { GlassCard, CardHeader } from '@/components/primitives/GlassCard';
import { StatusPill } from '@/components/primitives/StatusPill';
import { CAM } from '@/constants/testIds';

export const CameraView = () => {
  const [token, setTok] = useState(getToken());
  const [password, setPassword] = useState('');
  const [snapshots, setSnapshots] = useState([]);
  const [tick, setTick] = useState(0);
  const [checking, setChecking] = useState(false);
  const timerRef = useRef(null);

  // auto-refresh live snapshot every 2s
  useEffect(() => {
    if (!token) return;
    timerRef.current = setInterval(() => setTick((t) => t + 1), 2000);
    return () => clearInterval(timerRef.current);
  }, [token]);

  const unlock = async () => {
    setChecking(true);
    try {
      const r = await endpoints.authUnlock(password);
      setToken(r.token);
      setTok(r.token);
      toast.success('Camera unlocked');
      setPassword('');
    } catch (e) {
      toast.error('Wrong password. Try again.');
    } finally {
      setChecking(false);
    }
  };

  const lock = () => {
    clearToken();
    setTok('');
    setSnapshots([]);
    toast('Camera locked');
  };

  const takeSnapshot = () => {
    const url = endpoints.cameraSnapshotUrl(token);
    setSnapshots((s) => [{ url, at: new Date().toLocaleTimeString() }, ...s].slice(0, 8));
    toast.success('Snapshot captured');
  };

  const liveUrl = token ? endpoints.cameraSnapshotUrl(token) + `#${tick}` : null;

  return (
    <div data-testid={CAM.root} className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 py-6 lg:py-10">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Live camera</div>
          <h1 className="text-3xl md:text-5xl font-semibold text-white tracking-tight mt-1">
            Van <span className="text-aurora-teal">eyes</span> · rear feed
          </h1>
          <div className="text-sm text-slate-400 mt-2">
            Password-gated live stream · auto-refresh every 2s · snapshot to save.
          </div>
        </div>
        {token && (
          <div className="flex items-center gap-2">
            <StatusPill tone="red" data-testid={CAM.liveBadge}>LIVE</StatusPill>
            <button
              type="button"
              onClick={lock}
              className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm bg-white/[0.04] ring-1 ring-white/10 text-slate-200 hover:bg-white/[0.08]"
            >
              <Lock size={14} /> Lock
            </button>
          </div>
        )}
      </div>

      {!token ? (
        <GlassCard glow="purple" className="p-8 max-w-md mx-auto" data-testid={CAM.lockGate}>
          <div className="flex flex-col items-center text-center">
            <div className="h-16 w-16 rounded-2xl grid place-items-center bg-aurora-purple/15 ring-1 ring-aurora-purple/40 text-aurora-purple">
              <Lock size={26} />
            </div>
            <h2 className="text-xl font-semibold text-white mt-4">Camera is locked</h2>
            <p className="text-sm text-slate-400 mt-1">Enter the shared password to view the live feed.</p>
            <div className="mt-6 w-full">
              <input
                type="password"
                data-testid={CAM.passwordInput}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && unlock()}
                placeholder="Password"
                className="w-full rounded-xl bg-white/[0.04] ring-1 ring-white/10 focus:ring-aurora-teal/60 outline-none px-4 py-3 text-white placeholder:text-slate-500 num"
              />
              <button
                type="button"
                data-testid={CAM.unlockBtn}
                onClick={unlock}
                disabled={checking || !password}
                className="mt-3 w-full rounded-xl bg-gradient-to-r from-aurora-teal to-aurora-purple text-navy-900 font-semibold py-3 disabled:opacity-40 transition hover:brightness-110"
              >
                {checking ? 'Verifying…' : 'Unlock camera'}
              </button>
              <div className="text-[11px] text-slate-500 mt-3">Hint · default password is <span className="num text-aurora-teal">bongo</span></div>
            </div>
          </div>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-12 gap-4 lg:gap-6">
          <GlassCard className="col-span-12 lg:col-span-9 p-0 overflow-hidden" data-testid={CAM.frame}>
            <div className="relative bg-black/60">
              <img
                key={tick}
                src={liveUrl}
                alt="Live camera"
                className="w-full aspect-video object-cover"
              />
              <div className="absolute top-4 left-4 flex items-center gap-2">
                <StatusPill tone="red">
                  <motion.span
                    className="inline-block h-1.5 w-1.5 rounded-full bg-status-red"
                    animate={{ opacity: [1, 0.35, 1] }}
                    transition={{ duration: 1.2, repeat: Infinity }}
                  />
                  LIVE · REAR
                </StatusPill>
                <div className="text-[11px] text-slate-300/70 num backdrop-blur-md bg-white/5 px-2 py-1 rounded-md">1280 × 720 · 0.5 fps</div>
              </div>
              <div className="absolute bottom-4 right-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => setTick((t) => t + 1)}
                  className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm bg-black/40 ring-1 ring-white/15 text-white hover:bg-black/60 backdrop-blur"
                >
                  <RefreshCw size={14} /> Refresh
                </button>
                <button
                  type="button"
                  data-testid={CAM.snapshotBtn}
                  onClick={takeSnapshot}
                  className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm bg-aurora-teal text-navy-900 font-semibold ring-1 ring-aurora-teal/60 hover:brightness-110"
                >
                  <CameraIcon size={14} /> Snapshot
                </button>
              </div>
            </div>
          </GlassCard>

          <GlassCard className="col-span-12 lg:col-span-3 p-4" data-testid={CAM.strip}>
            <CardHeader label="Snapshots" hint={`${snapshots.length}/8 recent`} />
            {snapshots.length === 0 && (
              <div className="rounded-xl bg-white/[0.03] ring-1 ring-white/10 p-6 text-center text-sm text-slate-400 flex flex-col items-center gap-2">
                <ImageDown size={22} className="text-slate-500" />
                No snapshots yet — tap the shutter.
              </div>
            )}
            <ul className="space-y-3">
              {snapshots.map((s, i) => (
                <li key={i} className="rounded-xl overflow-hidden ring-1 ring-white/10 bg-black/40">
                  <img src={s.url} alt={`snap ${s.at}`} className="w-full aspect-video object-cover" />
                  <div className="px-3 py-2 text-[11px] text-slate-400 num">{s.at}</div>
                </li>
              ))}
            </ul>
          </GlassCard>
        </div>
      )}
    </div>
  );
};
