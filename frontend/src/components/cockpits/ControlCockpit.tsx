import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BatteryCharging, ChevronDown, ChevronUp, Flame, Lightbulb, Power, Refrigerator, ShieldCheck, Thermometer, Video, Zap } from 'lucide-react';
import { api } from '@/lib/api';
import { isDemo } from '@/lib/demo';
import { useBattery, useEnvironment, useConnected } from '@/lib/telemetry';
import { fmtPct, fmtTemp, fmtVolt } from '@/lib/format';
import { useAutoFit } from '@/lib/useAutoFit';
import './control.css';

const DEMO_ROOF = { configured: true, max_run_seconds: 30 };
const FALLBACK_IMAGE = import.meta.env.BASE_URL + 'van.jpg';
type Direction = 'up' | 'down';

function relayIcon(name: string) {
  const n = name.toLowerCase();
  if (n.includes('fridge') || n.includes('refriger')) return <Refrigerator size={34} />;
  if (n.includes('light')) return <Lightbulb size={34} />;
  if (n.includes('amp') || n.includes('audio')) return <Zap size={34} />;
  if (n.includes('heater') || n.includes('heat')) return <Flame size={34} />;
  return <Power size={34} />;
}

export function ControlCockpit() {
  const fitRef = useAutoFit<HTMLDivElement>();
  const qc = useQueryClient();
  const battery = useBattery().payload;
  const env = useEnvironment().payload;
  const connected = useConnected();
  const [roofActive, setRoofActive] = useState<Direction | null>(null);
  const roofTimer = useRef<number | null>(null);
  const relays = useQuery({ queryKey: ['relays'], queryFn: api.relays, refetchInterval: 8000, retry: 1 });
  const roof = useQuery({ queryKey: ['roof'], queryFn: api.roofStatus, refetchInterval: roofActive ? false : 8000, retry: 1 });
  const camera = useQuery({ queryKey: ['camera-status'], queryFn: api.cameraStatus, refetchInterval: 15000, retry: 1 });
  const location = useQuery({ queryKey: ['location'], queryFn: api.location, retry: false });
  const roofIds = useMemo(() => new Set([roof.data?.up_channel, roof.data?.down_channel, ...(roof.data?.isolate_channels ?? [])].filter((v): v is number => v != null)), [roof.data]);
  const switchRelays = (relays.data?.channels ?? []).filter(r => !roofIds.has(r.id)).slice(0, 4);
  const setRelay = useMutation({ mutationFn: ({ id, on }: { id: number; on: boolean }) => api.setRelay(id, on), onSuccess: () => qc.invalidateQueries({ queryKey: ['relays'] }) });
  const roofHold = useMutation({ mutationFn: (direction: Direction) => api.roofHold(direction) });
  const roofRelease = useMutation({ mutationFn: () => api.roofRelease() });
  const stopRoof = useCallback(() => {
    if (roofTimer.current !== null) { window.clearInterval(roofTimer.current); roofTimer.current = null; }
    setRoofActive(null);
    if (!isDemo) roofRelease.mutate();
  }, [roofRelease]);
  const startRoof = useCallback((direction: Direction) => {
    if (roofActive || (!isDemo && roof.data?.configured === false)) return;
    setRoofActive(direction);
    const tick = () => roofHold.mutate(direction);
    tick();
    roofTimer.current = window.setInterval(tick, 500);
  }, [roofActive, roof.data?.configured, roofHold]);
  useEffect(() => () => { if (roofTimer.current !== null) window.clearInterval(roofTimer.current); }, []);
  const streamAvailable = camera.data?.ustreamer?.reachable === true;
  const roofConfigured = Boolean((isDemo ? DEMO_ROOF : roof.data)?.configured);
  const cameraSrc = api.cameraStreamUrl();

  return <div className="vc-page" ref={fitRef}>
    <header className="vc-status">
      <div className="vc-clock">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      <div className="vc-pill"><span>GPS</span><b>{location.data?.satellites ?? '—'}</b></div>
      <div className="vc-pill"><Thermometer size={18} /><b>{fmtTemp(env?.external_temp_c)}</b></div>
      <div className="vc-pill"><BatteryCharging size={18} /><b>{fmtVolt(battery?.voltage)}</b><small>{fmtPct(battery?.soc_pct)}</small></div>
      <div className={'vc-live ' + (connected ? 'is-live' : '')}><i />{connected ? 'LIVE' : 'OFFLINE'}</div>
    </header>
    <main className="vc-main">
      <section className="vc-camera">
        <img src={streamAvailable ? cameraSrc : FALLBACK_IMAGE} alt={streamAvailable ? 'Van camera' : ''} aria-hidden={!streamAvailable} />
        <div className="vc-camera-scrim" />
        <div className="vc-camera-corner"><Video size={17} /> {streamAvailable ? 'LIVE' : 'NO SIGNAL'}</div>
      </section>
      <section className="vc-roof">
        <div className="vc-roof-icon" aria-hidden="true">⌂</div>
        <button type="button" aria-label="Open roof" disabled={!roofConfigured || roofActive === 'down'} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); startRoof('up'); }} onPointerUp={stopRoof} onPointerCancel={stopRoof} onPointerLeave={() => roofActive === 'up' && stopRoof()} onContextMenu={e => e.preventDefault()}><ChevronUp size={42} /></button>
        <button type="button" aria-label="Close roof" disabled={!roofConfigured || roofActive === 'up'} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); startRoof('down'); }} onPointerUp={stopRoof} onPointerCancel={stopRoof} onPointerLeave={() => roofActive === 'down' && stopRoof()} onContextMenu={e => e.preventDefault()}><ChevronDown size={42} /></button>
        <span className="vc-roof-unknown">POSITION UNKNOWN</span>
      </section>
      <section className="vc-switches">
        {switchRelays.map(r => <article className={'vc-switch ' + (r.in_use ? '' : 'is-spare')} key={r.id}>
          <div className="vc-switch-led" aria-hidden="true" /><div className="vc-switch-icon" aria-hidden="true">{relayIcon(r.name)}</div><strong>{r.name}</strong>
          <button type="button" aria-label={'Toggle ' + r.name} disabled={setRelay.isPending} onClick={() => setRelay.mutate({ id: r.id, on: !r.commanded_on })}><Power size={38} /></button>
        </article>)}
      </section>
    </main>
    <div className="vc-footnote"><ShieldCheck size={15} /> Relay commands only · roof position unknown</div>
  </div>;
}
