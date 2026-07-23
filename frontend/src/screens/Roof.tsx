import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronUp, ChevronDown, TriangleAlert, Info } from 'lucide-react';
import { GlassCard } from '@/components/primitives/GlassCard';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

const HOLD_INTERVAL_MS = 500;

export function Roof() {
  const [active, setActive] = useState<'up' | 'down' | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [camUrl, setCamUrl] = useState(() => api.cameraSnapshotUrl(Date.now()));
  const timerRef = useRef<number | null>(null);
  const startedRef = useRef(0);

  const status = useQuery({
    queryKey: ['roof'],
    queryFn: api.roofStatus,
    refetchInterval: active ? false : 10_000,
    retry: 1,
  });

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setActive(null);
    setElapsed(0);
    api.roofRelease().catch(() => {
      // The backend watchdog stops the roof within ~1.5s regardless,
      // so a failed release is not a safety problem - it just means
      // the stop is slightly less immediate.
    });
  }, []);

  const start = useCallback(
    (direction: 'up' | 'down') => {
      if (active) return;
      setMessage(null);
      setActive(direction);
      startedRef.current = Date.now();

      const tick = async () => {
        try {
          await api.roofHold(direction);
          setElapsed((Date.now() - startedRef.current) / 1000);
        } catch (e) {
          // 409 means the backend refused or stopped us - surface why
          // rather than silently doing nothing.
          setMessage(e instanceof ApiError ? e.message : 'Lost contact with the van');
          stop();
        }
      };

      void tick();
      timerRef.current = window.setInterval(tick, HOLD_INTERVAL_MS);
    },
    [active, stop],
  );

  // Safety net: if the page is hidden, the window loses focus, or the
  // component unmounts mid-movement, stop sending holds. The backend
  // watchdog would catch it anyway - this just makes it immediate.
  useEffect(() => {
    const onLeave = () => { if (active) stop(); };
    document.addEventListener('visibilitychange', onLeave);
    window.addEventListener('blur', onLeave);
    window.addEventListener('pagehide', onLeave);
    return () => {
      document.removeEventListener('visibilitychange', onLeave);
      window.removeEventListener('blur', onLeave);
      window.removeEventListener('pagehide', onLeave);
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, [active, stop]);

  // Refresh the camera faster while the roof is moving - that's when
  // you actually need to see it - and slower otherwise to spare the Pi.
  useEffect(() => {
    const period = active ? 800 : 3000;
    const id = window.setInterval(() => {
      const next = api.cameraSnapshotUrl(Date.now());
      const img = new Image();
      img.onload = () => setCamUrl(next);
      img.src = next;
    }, period);
    return () => window.clearInterval(id);
  }, [active]);

  const st = status.data;
  const configured = st?.configured ?? false;

  if (status.isLoading) return null;

  if (!configured) {
    return (
      <div className="max-w-3xl">
        <GlassCard className="p-6">
          <div className="flex items-start gap-3">
            <TriangleAlert size={18} className="text-status-amber mt-0.5 shrink-0" />
            <div className="text-sm text-ink-soft">
              <div className="font-medium text-ink">Roof control isn't set up.</div>
              <p className="mt-1 text-ink-muted">
                Assign the up and down relay channels and enable it in the roof config before use. It stays disabled by
                default deliberately &mdash; a fresh install should never be able to drive a roof motor.
              </p>
            </div>
          </div>
        </GlassCard>
      </div>
    );
  }

  const pct = Math.min(100, (elapsed / (st?.max_run_seconds ?? 30)) * 100);

  return (
    <div className="max-w-3xl space-y-4">
      <GlassCard className="p-5">
        <div className="flex items-start gap-3 text-sm">
          <Info size={16} className="text-ink-muted mt-0.5 shrink-0" />
          <div className="text-ink-muted">
            Hold a button to move the roof &mdash; it stops the moment you let go, exactly like the switch on the wall.
            The engine must be running and the handbrake on, same as always. The app can't tell whether the roof
            actually moved, so watch it.
          </div>
        </div>
      </GlassCard>

      <div className="grid grid-cols-2 gap-4">
        {(['up', 'down'] as const).map((dir) => {
          const Icon = dir === 'up' ? ChevronUp : ChevronDown;
          const isActive = active === dir;
          const disabled = active !== null && !isActive;
          return (
            <button
              key={dir}
              type="button"
              disabled={disabled}
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); start(dir); }}
              onPointerUp={stop}
              onPointerCancel={stop}
              onPointerLeave={() => { if (isActive) stop(); }}
              onContextMenu={(e) => e.preventDefault()}
              className={cn(
                'select-none touch-none rounded-2xl border py-10 flex flex-col items-center gap-2 transition',
                isActive
                  ? 'border-aurora-teal bg-aurora-teal/15 text-aurora-teal'
                  : 'border-ink/10 bg-ink/[0.03] text-ink-soft hover:bg-ink/[0.06]',
                disabled && 'opacity-30',
              )}
            >
              <Icon size={40} />
              <span className="text-lg font-medium capitalize">{dir}</span>
              <span className="text-[11px] text-ink-faint">{isActive ? 'Moving — release to stop' : 'Press and hold'}</span>
            </button>
          );
        })}
      </div>

      {active && (
        <GlassCard className="p-5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-aurora-teal font-medium capitalize">Moving {active}</span>
            <span className="num text-ink-muted">
              {elapsed.toFixed(1)}s / {st?.max_run_seconds}s
            </span>
          </div>
          <div className="mt-3 h-1.5 rounded-full bg-ink/10 overflow-hidden">
            <div className="h-full bg-aurora-teal transition-[width] duration-200" style={{ width: `${pct}%` }} />
          </div>
        </GlassCard>
      )}

      {message && (
        <GlassCard className="p-4">
          <div className="text-sm text-status-amber">{message}</div>
        </GlassCard>
      )}

      <GlassCard className="p-0 overflow-hidden">
        <img
          src={camUrl}
          alt="Live view"
          className="w-full max-h-[50vh] object-contain bg-black"
        />
        <div className="px-4 py-2 text-[11px] text-ink-faint">Live camera — point it at the roof to watch from here</div>
      </GlassCard>
    </div>
  );
}
