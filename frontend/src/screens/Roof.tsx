import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronUp, ChevronDown, TriangleAlert, Info, ShieldCheck, CircleStop, Video } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { isDemo } from '@/lib/demo';
import './cockpit-screen.css';
import './cockpit-roof.css';
import './cockpit-roof-animation.css';

const HOLD_INTERVAL_MS = 500;
const DEMO_ROOF = { configured: true, max_run_seconds: 30 };
const ROOF_OPENING_VIDEO = `${import.meta.env.BASE_URL}roof/bongo-roof-opening.mp4`;
const ROOF_CLOSING_VIDEO = `${import.meta.env.BASE_URL}roof/bongo-roof-closing.mp4`;

// Opening and closing are separate forward-played videos. The closing footage is generated from the real opening footage in CI so the browser never has to seek an H.264 file backwards.

export function Roof() {
  const [active, setActive] = useState<'up' | 'down' | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [visualPosition, setVisualPosition] = useState(0);
  const [videoSrc, setVideoSrc] = useState(ROOF_OPENING_VIDEO);
  const timerRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const directionRef = useRef<'up' | 'down'>('up');
  const targetTimeRef = useRef<number | null>(null);

  const status = useQuery({
    queryKey: ['roof'],
    queryFn: api.roofStatus,
    enabled: !isDemo,
    refetchInterval: active ? false : 10000,
    retry: 1,
  });

  const syncVisual = useCallback(() => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
    const raw = Math.max(0, Math.min(1, video.currentTime / video.duration));
    const next = directionRef.current === 'up' ? raw : 1 - raw;
    setVisualPosition(prev => Math.abs(prev - next) < 0.005 ? prev : next);
  }, []);

  const stopVisual = useCallback(() => {
    const video = videoRef.current;
    if (video) video.pause();
    targetTimeRef.current = null;
    syncVisual();
  }, [syncVisual]);

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    stopVisual();
    setActive(null);
    setElapsed(0);
    if (!isDemo) api.roofRelease().catch(() => {});
  }, [stopVisual]);

  const start = useCallback((direction: 'up' | 'down') => {
    if (active) return;
    setMessage(null);
    directionRef.current = direction;
    targetTimeRef.current = direction === 'up' ? visualPosition : 1 - visualPosition;
    setVideoSrc(direction === 'up' ? ROOF_OPENING_VIDEO : ROOF_CLOSING_VIDEO);
    setActive(direction);

    const started = Date.now();
    const tick = async () => {
      try {
        if (!isDemo) await api.roofHold(direction);
        setElapsed((Date.now() - started) / 1000);
      } catch (e) {
        setMessage(e instanceof ApiError ? e.message : 'Lost contact with the van');
        stop();
      }
    };

    void tick();
    timerRef.current = window.setInterval(tick, HOLD_INTERVAL_MS);
  }, [active, stop, visualPosition]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !active) return;

    const prepare = () => {
      const target = targetTimeRef.current;
      if (target === null || !Number.isFinite(video.duration) || video.duration <= 0) return;
      video.currentTime = Math.max(0, Math.min(video.duration, target * video.duration));
      targetTimeRef.current = null;
      video.play().catch(() => setMessage('Roof movement video could not be started'));
    };

    video.pause();
    video.addEventListener('loadedmetadata', prepare, { once: true });
    video.load();
    if (video.readyState >= 1) prepare();

    return () => video.removeEventListener('loadedmetadata', prepare);
  }, [videoSrc, active]);

  useEffect(() => {
    const onLeave = () => { if (active) stop(); };
    document.addEventListener('visibilitychange', onLeave);
    window.addEventListener('blur', onLeave);
    window.addEventListener('pagehide', onLeave);
    return () => {
      document.removeEventListener('visibilitychange', onLeave);
      window.removeEventListener('blur', onLeave);
      window.removeEventListener('pagehide', onLeave);
    };
  }, [active, stop]);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
  }, []);

  const st = isDemo ? DEMO_ROOF : status.data;
  if (!isDemo && status.isLoading) return <div className="cs-page"><div className="cs-loading">Checking roof controller…</div></div>;
  if (!st?.configured) {
    return <div className="cs-page"><div className="cs-warning"><TriangleAlert size={22} /><div><span className="cs-kicker">ROOF CONTROL</span><h1>Not configured</h1><p>Assign the up and down relay channels and enable roof control before use. It stays disabled by default deliberately.</p></div></div></div>;
  }

  const pct = Math.min(100, (elapsed / (st.max_run_seconds ?? 30)) * 100);

  return (
    <div className="cs-page">
      <header className="cs-heading">
        <div>
          <span className="cs-kicker">VANOS · ROOF CONTROL</span>
          <h1>Pop-top <em>roof</em></h1>
          <p>Press and hold to move. Release to stop.</p>
        </div>
        <div className="cs-safety"><ShieldCheck size={16} /> WATCHDOG PROTECTED</div>
      </header>

      <div className="cs-safety-note">
        <Info size={18} />
        <span>VanOS has no roof position sensor. It cannot tell whether the roof is open or closed. The physical wall switch and the existing engine/handbrake interlock remain authoritative.</span>
      </div>

      <section className={`cs-roof-stage ${active ? `is-${active}` : ''}`}>
        <div className="cs-roof-photo">
          <video
            ref={videoRef}
            className="cs-roof-video"
            src={videoSrc}
            preload="auto"
            muted
            playsInline
            aria-label="Mazda Bongo Auto Free Top roof movement"
            onTimeUpdate={syncVisual}
            // The reference video only ILLUSTRATES a movement; it must never
            // control the motor. It used to stop the roof when the clip ended -
            // a couple of seconds, shorter than a real close - so closing cut
            // out every ~2s. Now it just holds its last frame. Only the finger
            // (release), the Pi's watchdog and the 30s ceiling stop the roof.
            onError={() => setMessage('Roof movement video is not available on this build')}
          />
          <div className="cs-roof-photo-shade" />
          <div className="cs-roof-live">
            <span>{active ? (active === 'up' ? 'OPENING REFERENCE' : 'CLOSING REFERENCE') : 'ROOF POSITION'}</span>
            <b>{active ? `${Math.round(visualPosition * 100)}%` : 'UNKNOWN'}</b>
          </div>
          <div className="cs-roof-video-badge"><Video size={14} /> REAL ROOF VIDEO</div>
        </div>

        <div className="cs-roof-side">
          <div className="cs-roof-controls">
            {(['up', 'down'] as const).map(dir => {
              const Icon = dir === 'up' ? ChevronUp : ChevronDown;
              const isActive = active === dir;
              const disabled = active !== null && !isActive;
              return (
                <button
                  key={dir}
                  type="button"
                  disabled={disabled}
                  onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); start(dir); }}
                  onPointerUp={stop}
                  onPointerCancel={stop}
                  onPointerLeave={() => { if (isActive) stop(); }}
                  onContextMenu={e => e.preventDefault()}
                  className={`cs-roof-button ${isActive ? 'active' : ''}`}
                >
                  <Icon size={38} />
                  <strong>{dir === 'up' ? 'OPEN' : 'CLOSE'}</strong>
                  <small>{isActive ? 'MOVING · RELEASE TO STOP' : 'PRESS AND HOLD'}</small>
                </button>
              );
            })}
          </div>

          <div className="cs-roof-status-card">
            <div className="cs-roof-status-icon"><CircleStop size={18} /></div>
            <div>
              <span>POSITION</span>
              <strong>UNKNOWN</strong>
              <small>No position sensor fitted</small>
            </div>
          </div>
        </div>
      </section>

      {active && (
        <div className="cs-run">
          <div><span>ROOF MOTOR · {active.toUpperCase()}</span><b>{elapsed.toFixed(1)}s</b></div>
          <div className="cs-run-bar"><i style={{ width: `${pct}%` }} /></div>
          <small>Maximum run {st.max_run_seconds}s · release button to stop</small>
        </div>
      )}
      {message && <div className="cs-error"><TriangleAlert size={18} />{message}</div>}
    </div>
  );
}
