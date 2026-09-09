import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Flame, Minus, Plus, Mountain, CircleGauge, ArrowLeftRight, Loader2 } from 'lucide-react';
import { GlassCard } from '@/components/primitives/GlassCard';
import { api, ApiError } from '@/lib/api';

/**
 * Diesel heater control, laid out to match the Hcalory phone app -
 * deliberately, because that is the layout already learned. Big target
 * temperature with minus/plus, the four readings in a row beneath it,
 * three mode buttons, and the heating bar at the bottom.
 *
 * The difference from the app is what it refuses to do. Ignition and
 * cooldown are uninterruptible: the backend rejects a stop mid-ignition
 * (unburnt fuel in the burner - it is what fouled the last heater's
 * exhaust) and a start mid-cooldown. Those controls are disabled here
 * too, with the reason shown, rather than letting someone press a
 * button and watch nothing happen.
 */

const MIN_TEMP = 8;
const MAX_TEMP = 36;

function stateLabel(s: { state?: number | null; igniting?: boolean; cooling_down?: boolean }) {
  if (s.igniting) return { text: 'Igniting', tone: 'warm' as const };
  if (s.cooling_down) return { text: 'Cooling down', tone: 'warm' as const };
  // The heater's own high-nibble status: 0 off, 8 heating, C ventilation,
  // F error. Anything else is shown as-is rather than guessed at.
  switch (s.state) {
    case 0: return { text: 'Off', tone: 'idle' as const };
    case 8: return { text: 'Running', tone: 'good' as const };
    case 0xc: return { text: 'Ventilating', tone: 'good' as const };
    case 0xf: return { text: 'Fault', tone: 'bad' as const };
    default: return { text: s.state == null ? 'Unknown' : `State ${s.state}`, tone: 'idle' as const };
  }
}

export function Heater() {
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['heater'],
    queryFn: api.heater,
    // Faster than the plugin polls, so the screen catches a state change
    // within a few seconds of the heater reporting it.
    refetchInterval: 5_000,
    retry: (count, e) => !(e instanceof ApiError && e.status === 401) && count < 2,
  });

  const s = data?.state ?? {};
  const label = stateLabel(s);
  const running = s.state === 8 || s.state === 0xc || s.igniting;
  const locked = Boolean(s.igniting || s.cooling_down);

  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['heater'] }),
    onError: (e) => {
      // 409 is the heater saying "not now" - a normal, expected answer
      // during ignition or cooldown, not a failure. Shown as guidance
      // rather than an error.
      if (e instanceof ApiError && e.status === 409) toast.warning(e.message);
      else if (e instanceof ApiError && e.status === 503) toast.error('Not connected to the heater.');
      else toast.error('Command failed.');
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
    return (
      <div className="wrap" style={{ padding: '40px 32px' }}>
        <h1>Heater</h1>
        <div style={{ color: 'var(--grey)', marginTop: 16 }}>Loading…</div>
      </div>
    );
  }

  // Three genuinely different reasons the controls can't be used, and
  // the fix differs for each, so they don't share one message.
  if (error instanceof ApiError && error.status === 404) {
    return (
      <div className="wrap" style={{ padding: '40px 32px' }}>
        <h1>Heater</h1>
        <GlassCard className="p-6" style={{ marginTop: 20, color: 'var(--grey)' }}>
          The heater plugin isn't enabled. Turn it on in Settings → Plugins.
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="wrap" style={{ padding: '40px 32px 80px', maxWidth: 720 }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ marginBottom: 6 }}>Heater</h1>
        <span
          style={{
            display: 'inline-block', padding: '5px 16px', borderRadius: 999, fontSize: 14,
            background: label.tone === 'good' ? 'rgba(60,180,110,.14)'
              : label.tone === 'warm' ? 'rgba(225,105,31,.16)'
              : label.tone === 'bad' ? 'rgba(220,70,70,.16)' : 'rgba(238,241,240,.06)',
            color: label.tone === 'good' ? '#5FD39B'
              : label.tone === 'warm' ? '#F09150'
              : label.tone === 'bad' ? '#F08080' : 'var(--grey)',
          }}
        >
          {label.text}
        </span>
      </div>

      {!data?.available && (
        <GlassCard className="p-5" style={{ marginTop: 22, color: 'var(--grey)', fontSize: 14 }}>
          Not connected to the heater. Only one device can hold the Bluetooth link at a time —
          if the Hcalory phone app is connected, VanOS can't be.
          {data?.error && <div style={{ marginTop: 8, fontSize: 13 }}>{data.error}</div>}
        </GlassCard>
      )}

      {s.error_code ? (
        <GlassCard
          className="p-5"
          style={{ marginTop: 22, fontSize: 14, background: 'rgba(220,70,70,.10)', color: '#F08080' }}
        >
          Heater fault E-{String(s.error_code).padStart(2, '0')}.
        </GlassCard>
      ) : null}

      {/* Target temperature, the way the app shows it. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 28, marginTop: 34 }}>
        <button
          type="button"
          onClick={() => nudge(-1)}
          disabled={busy || target == null || !data?.available}
          aria-label="Lower target temperature"
          style={btn}
        >
          <Minus size={22} />
        </button>

        <div style={{ minWidth: 168, textAlign: 'center' }}>
          <span className="num" style={{ fontSize: 62, fontWeight: 600, lineHeight: 1 }}>
            {/* Off, the heater reports no setpoint at all. A dash is the
                honest answer; showing the last known one would imply it
                is still targeting something. */}
            {target != null ? target : '—'}
          </span>
          <span className="num" style={{ fontSize: 26, color: 'var(--grey)' }}>°C</span>
        </div>

        <button
          type="button"
          onClick={() => nudge(1)}
          disabled={busy || target == null || !data?.available}
          aria-label="Raise target temperature"
          style={btn}
        >
          <Plus size={22} />
        </button>
      </div>

      {/* The four readings, in the app's order. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18, marginTop: 30, textAlign: 'center' }}>
        <Reading value={s.voltage != null ? `${s.voltage.toFixed(1)}V` : '—'} label="Voltage" />
        <Reading
          value={s.body_temperature_c != null ? `${s.body_temperature_c}°C` : '—'}
          label="Body temp"
        />
        <Reading
          value={s.cabin_temperature_c != null ? `${s.cabin_temperature_c}°C` : '—'}
          label="Cabin temp"
        />
      </div>

      <GlassCard className="p-6" style={{ marginTop: 30 }}>
        <div style={{ display: 'flex', justifyContent: 'space-around', gap: 12 }}>
          <ModeButton
            icon={<Mountain size={20} />}
            label="High plateau"
            active={false}
            disabled
            title="Not wired up — only useful above 3000m, and this van is at sea level."
          />
          <ModeButton
            icon={<CircleGauge size={20} />}
            label="Auto start-stop"
            active={Boolean(s.auto_start_stop)}
            disabled={busy || !data?.available}
            onClick={() => act.mutate(() => api.heaterAutoStartStop())}
            title="Stops the burn at target and restarts when the van cools."
          />
          <ModeButton
            icon={<ArrowLeftRight size={20} />}
            label="Mode"
            active={s.mode === 2}
            disabled={busy || !data?.available}
            onClick={() => act.mutate(() => api.heaterMode(s.mode === 2 ? 'level' : 'temperature'))}
            title={s.mode === 2 ? 'Temperature mode — switch to fixed level' : 'Level mode — switch to temperature'}
          />
        </div>

        <button
          type="button"
          onClick={() => act.mutate(() => api.heaterPower(!running))}
          disabled={busy || locked || !data?.available}
          style={{
            marginTop: 26, width: '100%', padding: '16px 20px', borderRadius: 12, border: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            font: 'inherit', fontSize: 17, fontWeight: 600, cursor: locked ? 'not-allowed' : 'pointer',
            background: running ? 'rgba(220,70,70,.85)' : 'var(--lime)',
            color: '#fff', opacity: busy || locked || !data?.available ? 0.5 : 1,
          }}
        >
          {busy ? <Loader2 size={18} className="spin" /> : <Flame size={18} />}
          {running ? 'Stop heating' : 'Start heating'}
        </button>

        {/* The reason, not just a greyed-out button. */}
        {locked && (
          <div style={{ marginTop: 12, fontSize: 13, color: 'var(--grey)', textAlign: 'center' }}>
            {s.igniting
              ? 'Igniting — it can’t be stopped until the flame is established. Interrupting it leaves unburnt fuel in the burner.'
              : 'Cooling down — it must finish purging before it will start again.'}
          </div>
        )}
      </GlassCard>
    </div>
  );
}

const btn: React.CSSProperties = {
  width: 62, height: 62, borderRadius: 14, border: 0, cursor: 'pointer',
  background: 'rgba(238,241,240,.07)', color: 'var(--paper)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

function Reading({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="num" style={{ fontSize: 21, fontWeight: 600 }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--grey)', marginTop: 3 }}>{label}</div>
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
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        background: 'none', border: 0, cursor: disabled ? 'default' : 'pointer',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9,
        color: active ? '#F08080' : 'var(--grey)', opacity: disabled ? 0.4 : 1,
        font: 'inherit', fontSize: 12, width: 92,
      }}
    >
      <span
        style={{
          width: 52, height: 52, borderRadius: '50%',
          background: active ? 'rgba(220,70,70,.85)' : 'rgba(238,241,240,.07)',
          color: active ? '#fff' : 'var(--grey)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {icon}
      </span>
      {label}
    </button>
  );
}
