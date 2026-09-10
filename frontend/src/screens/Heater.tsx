import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Flame, Minus, Plus, Mountain, CircleGauge, ArrowLeftRight, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';

/**
 * Diesel heater control, laid out like the Hcalory phone app - big
 * target temperature with minus/plus, readings in a row beneath, three
 * mode buttons, heating bar at the bottom. That layout is already
 * learned; no reason to invent another.
 *
 * On a DARK PANEL rather than floating on the aurora background. The
 * first version put glass cards over the van photo and the numbers
 * were unreadable. This screen gets looked at in a cold van at night,
 * so contrast beats prettiness.
 *
 * TWO HONESTY PROBLEMS THIS FIXES
 *
 * This heater terminates the BLE link every 6-19 seconds and the agent
 * reconnects, so "connected" flickers constantly while the readings
 * are perfectly good. The first version treated every disconnection as
 * an error and led with a banner about the phone app holding the link -
 * usually wrong, and alarming about what is normal behaviour. It now
 * shows the reading's AGE, and only colours it when genuinely old.
 *
 * And it separates "the heater is off" from "we cannot see the
 * heater". The status pill said Off for both, which are very different
 * things to tell someone deciding whether to walk out to the van.
 */

const MIN_TEMP = 8;
const MAX_TEMP = 36;
/** Older than this is worth flagging. Comfortably longer than the
 *  reconnect cycle, so normal operation stays quiet. */
const AGE_WARN_SECONDS = 180;

function stateLabel(s: {
  state?: number | null; igniting?: boolean; cooling_down?: boolean; connected?: boolean;
}) {
  if (!s.connected && s.state == null) return { text: 'No signal', tone: 'idle' as const };
  if (s.igniting) return { text: 'Igniting', tone: 'warm' as const };
  if (s.cooling_down) return { text: 'Cooling down', tone: 'warm' as const };

  switch (s.state) {
    case 0: return { text: 'Off', tone: 'idle' as const };
    case 8: return { text: 'Running', tone: 'good' as const };
    case 0xc: return { text: 'Ventilating', tone: 'good' as const };
    case 0xf: return { text: 'Fault', tone: 'bad' as const };
    default: return { text: s.state == null ? 'Unknown' : `State ${s.state}`, tone: 'idle' as const };
  }
}

function ageText(updatedAt?: number | null): string | null {
  if (!updatedAt) return null;
  const seconds = Math.max(0, Math.round(Date.now() / 1000 - updatedAt));
  if (seconds < 30) return null; // fresh enough not to mention
  if (seconds < 90) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)} min ago`;
}

export function Heater() {
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['heater'],
    queryFn: api.heater,
    refetchInterval: 5_000,
    retry: (count, e) => !(e instanceof ApiError && e.status === 401) && count < 2,
  });

  const s = data?.state ?? {};
  const label = stateLabel(s);
  const running = s.state === 8 || s.state === 0xc || s.igniting;
  const locked = Boolean(s.igniting || s.cooling_down);
  const hasReadings = s.voltage != null || s.body_temperature_c != null;
  const age = ageText(s.updated_at);
  const old = Boolean(s.updated_at && Date.now() / 1000 - s.updated_at > AGE_WARN_SECONDS);
  const canCommand = Boolean(data?.available) && !locked;

  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['heater'] }),
    onError: (e) => {
      // 409 is the heater saying "not now" during ignition or cooldown -
      // expected, not a failure.
      if (e instanceof ApiError && e.status === 409) toast.warning(e.message);
      else if (e instanceof ApiError && e.status === 503) {
        toast.error('Lost the link to the heater - it reconnects every few seconds, try again.');
      } else toast.error('Command failed.');
      qc.invalidateQueries({ queryKey: ['heater'] });
    },
  });

  const busy = act.isPending;
  const target = s.target ?? null;

  const nudge = (delta: number) => {
    if (target == null) return;
    const next = Math.max(MIN_TEMP, Math.min(MAX_TEMP, target + delta));
    if (next !== target) act.mutate(() => api.heaterTemperature(next));
  };

  if (isLoading) {
    return <div style={page}><div style={panel}><div style={{ color: 'var(--grey)' }}>Loading...</div></div></div>;
  }

  if (error instanceof ApiError && error.status === 404) {
    return (
      <div style={page}>
        <div style={panel}>
          <h1 style={{ marginTop: 0 }}>Heater</h1>
          <p style={{ color: 'var(--grey)' }}>
            The heater plugin isn't enabled. Turn it on in Settings, under Plugins.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={page}>
      <div style={panel}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 13, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--grey)' }}>
            Diesel heater
          </div>
          <div style={{ marginTop: 10 }}>
            <span style={pill(label.tone)}>{label.text}</span>
          </div>
          {/* The reading's age, quietly, rather than a disconnection
              alarm. This heater drops the link every few seconds by
              design; saying so each time would be noise. */}
          {age && (
            <div style={{ marginTop: 8, fontSize: 12, color: old ? '#F09150' : 'var(--grey-dim)' }}>
              last reading {age}
            </div>
          )}
        </div>

        {!hasReadings && (
          <div style={notice}>
            No readings from the heater yet. The agent runs on the Pi - check
            {' '}<code>systemctl status vanos-heater-agent</code>.
            {data?.error && <div style={{ marginTop: 6, fontSize: 13 }}>{data.error}</div>}
          </div>
        )}

        {s.error_code ? (
          <div style={{ ...notice, background: 'rgba(220,70,70,.12)', color: '#F08080' }}>
            Heater fault E-{String(s.error_code).padStart(2, '0')}.
          </div>
        ) : null}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 30, marginTop: 34 }}>
          <button type="button" onClick={() => nudge(-1)} disabled={busy || target == null || !canCommand}
            aria-label="Lower target" style={round}>
            <Minus size={24} />
          </button>

          <div style={{ minWidth: 190, textAlign: 'center' }}>
            <span className="num" style={{ fontSize: 76, fontWeight: 600, lineHeight: 1 }}>
              {/* Off, the heater reports no setpoint at all. A dash is
                  honest; showing the last known one would imply it is
                  still targeting something. */}
              {target != null ? target : '\u2013\u2013'}
            </span>
            <span className="num" style={{ fontSize: 30, color: 'var(--grey)', marginLeft: 4 }}>&deg;C</span>
          </div>

          <button type="button" onClick={() => nudge(1)} disabled={busy || target == null || !canCommand}
            aria-label="Raise target" style={round}>
            <Plus size={24} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginTop: 32 }}>
          <Reading value={s.voltage != null ? `${s.voltage.toFixed(1)}V` : '\u2014'} label="Voltage" />
          <Reading value={s.body_temperature_c != null ? `${s.body_temperature_c}\u00b0C` : '\u2014'} label="Body temp" />
          <Reading value={s.cabin_temperature_c != null ? `${s.cabin_temperature_c}\u00b0C` : '\u2014'} label="Cabin temp" />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-around', gap: 10, marginTop: 34 }}>
          <ModeButton icon={<Mountain size={20} />} label="High plateau" active={false} disabled
            title="Only useful above 3000m. This van is at sea level, so it is left alone." />
          <ModeButton icon={<CircleGauge size={20} />} label="Auto start-stop"
            active={Boolean(s.auto_start_stop)} disabled={busy || !canCommand}
            onClick={() => act.mutate(() => api.heaterAutoStartStop())}
            title="Stops the burn at target and restarts when the van cools." />
          <ModeButton icon={<ArrowLeftRight size={20} />} label={s.mode === 2 ? 'Temp mode' : 'Level mode'}
            active={s.mode === 2} disabled={busy || !canCommand}
            onClick={() => act.mutate(() => api.heaterMode(s.mode === 2 ? 'level' : 'temperature'))}
            title="Switch between targeting a temperature and a fixed power level." />
        </div>

        <button type="button" onClick={() => act.mutate(() => api.heaterPower(!running))}
          disabled={busy || !canCommand}
          style={{
            marginTop: 30, width: '100%', padding: '18px 20px', borderRadius: 14, border: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            font: 'inherit', fontSize: 18, fontWeight: 600,
            cursor: canCommand ? 'pointer' : 'not-allowed',
            background: running ? '#D93A3A' : 'var(--lime)', color: '#fff',
            opacity: busy || !canCommand ? 0.45 : 1,
          }}>
          {busy ? <Loader2 size={20} className="spin" /> : <Flame size={20} />}
          {running ? 'Stop heating' : 'Start heating'}
        </button>

        {locked && (
          <div style={{ marginTop: 14, fontSize: 13, color: 'var(--grey)', textAlign: 'center' }}>
            {s.igniting
              ? 'Igniting - it cannot be stopped until the flame is established. Interrupting it leaves unburnt fuel in the burner.'
              : 'Cooling down - it must finish purging before it will start again.'}
          </div>
        )}

        {!data?.available && hasReadings && (
          <div style={{ marginTop: 14, fontSize: 12, color: 'var(--grey-dim)', textAlign: 'center' }}>
            Reconnecting - this heater drops the link every few seconds. Readings above are the last received.
          </div>
        )}
      </div>
    </div>
  );
}

const page: React.CSSProperties = {
  minHeight: '100%', padding: '34px 20px 90px', display: 'flex', justifyContent: 'center',
};

// Near-solid, not glass. The app's screen is a dark panel and these
// numbers have to be readable in a cold van at night.
const panel: React.CSSProperties = {
  width: '100%', maxWidth: 520, background: 'rgba(9,13,18,.93)',
  border: '1px solid rgba(238,241,240,.10)', borderRadius: 20, padding: '28px 26px 32px',
};

const notice: React.CSSProperties = {
  background: 'rgba(225,105,31,.12)', border: '1px solid rgba(225,105,31,.28)',
  padding: '13px 16px', borderRadius: 10, marginTop: 20, fontSize: 14,
};

const round: React.CSSProperties = {
  width: 68, height: 68, borderRadius: 18, border: 0, cursor: 'pointer',
  background: 'rgba(238,241,240,.08)', color: 'var(--paper)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

function pill(tone: 'good' | 'warm' | 'bad' | 'idle'): React.CSSProperties {
  const map = {
    good: ['rgba(60,180,110,.16)', '#5FD39B'],
    warm: ['rgba(225,105,31,.18)', '#F09150'],
    bad: ['rgba(220,70,70,.18)', '#F08080'],
    idle: ['rgba(238,241,240,.07)', 'var(--grey)'],
  } as const;
  const [bg, fg] = map[tone];
  return { display: 'inline-block', padding: '6px 20px', borderRadius: 999, fontSize: 15, background: bg, color: fg };
}

function Reading({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div className="num" style={{ fontSize: 24, fontWeight: 600 }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--grey)', marginTop: 4 }}>{label}</div>
    </div>
  );
}

function ModeButton({
  icon, label, active, disabled, onClick, title,
}: {
  icon: React.ReactNode; label: string; active: boolean;
  disabled?: boolean; onClick?: () => void; title?: string;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      style={{
        background: 'none', border: 0, cursor: disabled ? 'default' : 'pointer',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9,
        color: active ? '#F08080' : 'var(--grey)', opacity: disabled ? 0.4 : 1,
        font: 'inherit', fontSize: 12, width: 100,
      }}>
      <span style={{
        width: 56, height: 56, borderRadius: '50%',
        background: active ? '#D93A3A' : 'rgba(238,241,240,.08)',
        color: active ? '#fff' : 'var(--grey)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{icon}</span>
      {label}
    </button>
  );
}
