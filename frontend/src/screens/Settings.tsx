import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Wifi, WifiOff, Lock, Loader2, Radio, Sun, Moon, Mail, KeyRound, Sparkles, MapPin, Globe, Download, Upload, SignalHigh, Map, Trash2, Navigation, Volume2, ChevronDown, Play, Pause, Square } from 'lucide-react';
import { GlassCard, CardHeader } from '@/components/primitives/GlassCard';
import { GpsSatellitesCard } from '@/components/GpsSatellites';
import { RelayEventLog } from '@/components/RelayEventLog';
import { StatusPill } from '@/components/primitives/StatusPill';
import { api } from '@/lib/api';
import { isDemo } from '@/lib/demo';
import { useTheme } from '@/lib/theme';
import { signalToBars, getDistanceUnit, setDistanceUnit } from '@/lib/format';
import { SET } from '@/constants/testIds';
import { cn } from '@/lib/utils';
import { mapCacheEntries, clearMapCache } from '@/lib/mapStyle';

/**
 * A native <details>/<summary> collapsible wrapper for grouping
 * related Settings cards - no new React state needed, accessible by
 * default (keyboard/screen-reader support comes free from the browser
 * itself, not something to reimplement). Genuinely reduces how much of
 * this one long page needs scrolling past to find any given card.
 *
 * Defaults open (the `open` attribute) deliberately - nothing should
 * appear to have vanished on first load after this change; a group
 * only collapses if someone actually taps it closed. Each visitor's
 * own open/closed choice isn't persisted anywhere - a <details>
 * element's own native in-page state is enough for a single session,
 * and this isn't something worth a config write or localStorage entry.
 */
function CollapsibleGroup({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <details open className="col-span-12 group">
      {/* A bounded, glass-styled bar (not just text + a small arrow) so
          the whole row reads as a single tappable header, matching the
          same .glass language as the cards it contains - and giving a
          bigger touch target than a bare chevron did. list-none strips
          Chrome/Safari's default disclosure triangle so ours is the
          only one. */}
      <summary className="glass list-none flex items-center justify-between gap-3 cursor-pointer select-none rounded-2xl px-4 py-3.5 mb-3 transition-colors hover:bg-white/[0.03] marker:content-none [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <div className="text-base font-semibold text-ink tracking-wide">{title}</div>
          {hint && <div className="text-xs text-ink-faint mt-0.5 truncate">{hint}</div>}
        </div>
        <span className="shrink-0 flex items-center justify-center h-8 w-8 rounded-full bg-ink/[0.06] ring-1 ring-inset ring-ink/10 transition-transform duration-200 group-open:rotate-180 group-open:bg-aurora-teal/15 group-open:ring-aurora-teal/30">
          <ChevronDown size={16} className="text-ink-soft group-open:text-aurora-teal" />
        </span>
      </summary>
      <div className="grid grid-cols-12 gap-4 lg:gap-6">{children}</div>
    </details>
  );
}

function Bars({ dbm }: { dbm: number | null | undefined }) {
  const bars = signalToBars(dbm);
  return (
    <div className="flex items-end gap-0.5 h-4">
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className={cn('w-1 rounded-sm', i <= bars ? 'bg-aurora-teal' : 'bg-ink/15')} style={{ height: `${i * 25}%` }} />
      ))}
    </div>
  );
}

/**
 * LocationCard — restored after the aurora frontend rebuild dropped it.
 * The van's location can be set three ways, best-accuracy first:
 *   1. GPS from this device (needs HTTPS — browsers block geolocation on http)
 *   2. Manual lat/long (works offline, over http, dead accurate — the van-proof one)
 *   3. Approximate IP lookup (needs internet, only city-accurate — resolves the
 *      Pi's ISP, which is why it drifts to the wrong town)
 */
function LocationCard() {
  const qc = useQueryClient();
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');

  const loc = useQuery({ queryKey: ['location'], queryFn: api.location, retry: false });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['location'] });
    qc.invalidateQueries({ queryKey: ['weather'] });
    qc.invalidateQueries({ queryKey: ['poi-nearby'] });
  };

  const useIp = useMutation({
    mutationFn: () => api.ipFallback(),
    onSuccess: () => { toast.success('Approximate location set from the internet'); refresh(); },
    onError: () => toast.error('IP location failed — this one needs internet.'),
  });

  const setManual = () => {
    const la = parseFloat(lat);
    const lo = parseFloat(lng);
    if (!Number.isFinite(la) || !Number.isFinite(lo) || la < -90 || la > 90 || lo < -180 || lo > 180) {
      toast.error('Enter a valid latitude (−90…90) and longitude (−180…180).');
      return;
    }
    api.setLocation(la, lo)
      .then(() => { toast.success('Location set manually'); setLat(''); setLng(''); refresh(); })
      .catch(() => toast.error('Could not save location.'));
  };

  const d = loc.data;
  const has = !!d && d.latitude != null && d.longitude != null;
  const hint = !has ? 'none set yet' : d!.source === 'gps' ? 'from GPS' : `approx (IP)${d!.city ? ` · ${d!.city}` : ''}`;

  return (
    <GlassCard className="col-span-12 lg:col-span-5 p-6" data-testid={SET.location}>
      <CardHeader label="Location" hint={hint} right={<MapPin size={16} className="text-aurora-teal" />} />
      {has ? (
        <div className="rounded-xl bg-ink/[0.03] ring-1 ring-ink/10 px-4 py-3">
          <div className="num text-lg">{d!.latitude!.toFixed(4)}, {d!.longitude!.toFixed(4)}</div>
          <div className="text-[11px] text-ink-faint mt-1">
            {d!.source === 'gps' ? "From this device's GPS" : `Approximate (IP-based)${d!.city ? ` — near ${d!.city}` : ''}`}
            {d!.updated_at ? ` · updated ${new Date(d!.updated_at * 1000).toLocaleString()}` : ''}
          </div>
          {d!.source === 'gps' && d!.satellites != null && (
            <div className={`text-[11px] mt-1 font-medium ${d!.satellites < 4 ? 'text-status-amber' : 'text-aurora-teal'}`}>
              {d!.satellites} satellite{d!.satellites === 1 ? '' : 's'} in fix
              {d!.satellites < 4 ? ' — weak fix' : d!.satellites < 7 ? ' — ok fix' : ' — good fix'}
              {d!.hdop != null ? ` · HDOP ${d!.hdop.toFixed(1)}` : ''}
            </div>
          )}
        </div>
      ) : (
        <div className="text-sm text-ink-muted">No location set yet — set it manually below, or via the internet.</div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => useIp.mutate()}
          disabled={useIp.isPending}
          className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm bg-ink/[0.04] ring-1 ring-ink/10 text-ink-soft hover:bg-ink/[0.08] disabled:opacity-40"
        >
          {useIp.isPending ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />} Approximate (IP)
        </button>
      </div>

      <div className="mt-4">
        <label className="text-[11px] uppercase tracking-widest text-ink-muted">Set manually (works offline)</label>
        <div className="mt-2 flex gap-2">
          <input
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            placeholder="lat 55.011"
            className="w-full min-w-0 rounded-xl bg-ink/[0.04] ring-1 ring-ink/10 focus:ring-aurora-teal/50 outline-none px-3 py-2 text-sm num"
          />
          <input
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            placeholder="lng -1.446"
            className="w-full min-w-0 rounded-xl bg-ink/[0.04] ring-1 ring-ink/10 focus:ring-aurora-teal/50 outline-none px-3 py-2 text-sm num"
          />
          <button
            type="button"
            onClick={setManual}
            className="rounded-xl px-4 py-2 text-sm bg-aurora-teal/15 text-aurora-teal ring-1 ring-aurora-teal/40 hover:bg-aurora-teal/25"
          >
            Set
          </button>
        </div>
        <div className="text-[11px] text-ink-faint mt-1">GPS needs the https address · IP needs internet and is only city-accurate.</div>
      </div>
    </GlassCard>
  );
}

/**
 * Saved map data.
 *
 * Map tiles now live in a cache that deliberately survives deploys (see
 * public/service-worker.js — that purge was why maps were a black
 * rectangle offline). Something that survives updates needs a visible
 * way to empty it, so here it is.
 *
 * Counted in tiles, not megabytes, on purpose: the Cache API won't tell
 * us the real byte size without reading every entry back, and quoting a
 * made-up MB figure is exactly the kind of invented number this project
 * doesn't do.
 */
function OfflineMapsCard() {
  const [entries, setEntries] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    mapCacheEntries().then(setEntries);
  };
  useEffect(refresh, []);

  const clear = async () => {
    setBusy(true);
    const ok = await clearMapCache();
    setBusy(false);
    if (ok) {
      toast.success('Saved map data cleared');
      refresh();
    } else {
      toast.error('Could not clear saved maps');
    }
  };

  return (
    <GlassCard className="col-span-12 lg:col-span-5 p-6">
      <CardHeader
        label="Offline maps"
        hint={entries === null ? 'not available in this browser' : `${entries} tiles saved`}
        right={<Map size={16} className="text-aurora-teal" />}
      />
      <div className="rounded-xl bg-ink/[0.03] ring-1 ring-ink/10 px-4 py-3">
        <div className="text-[11px] text-ink-faint">
          Use <span className="text-ink-soft">Save this area</span> on any map while you've got signal. What you save
          stays put through app updates, and is what the map draws from when there's no connection.
        </div>
      </div>
      <div className="mt-4">
        <button
          type="button"
          onClick={clear}
          disabled={busy || !entries}
          className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm bg-ink/[0.04] ring-1 ring-ink/10 text-ink-soft hover:bg-ink/[0.08] disabled:opacity-40"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Clear saved maps
        </button>
      </div>
    </GlassCard>
  );
}

/**
 * Modem diagnostics — one-tap "check now" against the van's own Huawei
 * B525, no terminal or token-hunting required. Manual only (no
 * auto-refresh, no polling) since this is a first-contact test: does
 * the router answer, and do the field names look like what
 * modem_service.py expects. Once confirmed, this is the seed for GPS-
 * tagged logging and a measured-signal heatmap on the map.
 */
function ModemDiagnosticsCard() {
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ['config-general'], queryFn: () => api.getConfig('general'), enabled: !isDemo });
  const [hostOverride, setHostOverride] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (cfg.data && !seeded) {
      setHostOverride(String(cfg.data.modem_host ?? ''));
      setUsername(String(cfg.data.modem_username ?? ''));
      setSeeded(true);
    }
  }, [cfg.data, seeded]);
  const passwordSet = cfg.data?.modem_password_set === true;

  const saveHost = useMutation({
    mutationFn: () => {
      const value: Record<string, unknown> = { modem_host: hostOverride.trim(), modem_username: username.trim() };
      if (password.trim()) value.modem_password = password.trim(); // omit when blank -> keeps existing password
      return api.setConfig('general', value);
    },
    onSuccess: () => {
      toast.success('Router settings saved');
      setPassword('');
      qc.invalidateQueries({ queryKey: ['config-general'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Save failed'),
  });

  const check = useMutation({
    mutationFn: api.modemSignal,
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not reach the modem'),
  });

  return (
    <GlassCard className="col-span-12 lg:col-span-6 p-6">
      <CardHeader label="Modem diagnostics" hint="raw reading from the van's own router" />
      <div className="text-[11px] text-ink-faint mb-3">
        Reads real signal (RSRP/RSRQ/SINR) straight from the Huawei B525 over the Pi's own WiFi link to it — separate
        from the WiFi bars shown elsewhere (those are the Pi↔router link, not mobile signal) and from the predicted
        Ofcom coverage on the Signal page.
      </div>

      <label className="text-[11px] uppercase tracking-widest text-ink-muted">Router IP (optional)</label>
      <input
        value={hostOverride}
        onChange={(e) => setHostOverride(e.target.value)}
        placeholder="auto-detected from the Pi's default route"
        className="mt-1.5 w-full rounded-xl bg-ink/[0.04] ring-1 ring-ink/10 focus:ring-aurora-teal/50 outline-none px-3 py-2 text-sm num"
      />
      <div className="text-[11px] text-ink-faint mt-1 mb-3">
        Leave blank to auto-detect (the Pi's own default gateway). Only set this if that guess is wrong — e.g. after
        changing the router's DHCP range.
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] uppercase tracking-widest text-ink-muted">Router username</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="admin"
            className="mt-1.5 w-full rounded-xl bg-ink/[0.04] ring-1 ring-ink/10 focus:ring-aurora-teal/50 outline-none px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-widest text-ink-muted">Router password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={passwordSet ? '•••••••• set — blank keeps it' : 'only if the router needs login'}
            className="mt-1.5 w-full rounded-xl bg-ink/[0.04] ring-1 ring-ink/10 focus:ring-aurora-teal/50 outline-none px-3 py-2 text-sm"
          />
        </div>
      </div>
      <div className="text-[11px] text-ink-faint mt-1 mb-3">
        Leave both blank unless the router rejects an anonymous read (you'll see "needs login" in the result below) —
        some HiLink routers require it, some don't. Password is write-only, same as the other keys on this page.
      </div>
      <button
        type="button"
        onClick={() => saveHost.mutate()}
        disabled={saveHost.isPending}
        className="rounded-full px-4 py-2 text-xs font-medium bg-ink/[0.04] ring-1 ring-ink/10 text-ink-soft hover:bg-ink/[0.08] disabled:opacity-40 mb-4"
      >
        Save router settings
      </button>

      <div>
        <button
          type="button"
          onClick={() => check.mutate()}
          disabled={check.isPending}
          className="rounded-full px-4 py-2 text-sm bg-aurora-teal text-navy-900 font-semibold hover:brightness-110 disabled:opacity-40 flex items-center gap-2"
        >
          {check.isPending ? <Loader2 size={14} className="animate-spin" /> : <Radio size={14} />}
          {check.isPending ? 'Checking…' : 'Check now'}
        </button>
      </div>
      {check.isError && (
        <div className="mt-3 text-sm text-status-amber">
          {check.error instanceof Error ? check.error.message : 'Could not reach the modem'}
        </div>
      )}
      {check.isSuccess && (
        <>
          <div className="mt-3 text-[11px] text-ink-faint">Queried {check.data.host}</div>
          <pre className="mt-1 text-xs bg-ink/[0.04] ring-1 ring-ink/10 rounded-xl p-3 overflow-auto max-h-64 num">
            {JSON.stringify(check.data.raw, null, 2)}
          </pre>
        </>
      )}
    </GlassCard>
  );
}

/**
 * Voice control — Vosk wake word (local, free, no account needed) +
 * Groq for transcription/reply/speech (needs a connection - see
 * voice_control_service.py's module docstring for why that split).
 * Live status polling (not a one-shot "check now" like the modem card)
 * so saying the wake word and watching this update is itself the test.
 */
function VoiceControlCard() {
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ['config-general'], queryFn: () => api.getConfig('general'), enabled: !isDemo });
  const [groqKey, setGroqKey] = useState('');
  const [wakeWord, setWakeWord] = useState('');
  const [micDevice, setMicDevice] = useState('');
  const [playbackDevice, setPlaybackDevice] = useState('');
  const [speechThreshold, setSpeechThreshold] = useState('');
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (cfg.data && !seeded) {
      setWakeWord(String(cfg.data.voice_wake_word ?? ''));
      setMicDevice(String(cfg.data.voice_mic_device ?? ''));
      setPlaybackDevice(String(cfg.data.voice_playback_device ?? ''));
      setSpeechThreshold(cfg.data.voice_speech_rms_threshold != null ? String(cfg.data.voice_speech_rms_threshold) : '');
      setSeeded(true);
    }
  }, [cfg.data, seeded]);
  const groqKeySet = cfg.data?.groq_api_key_set === true;

  const save = useMutation({
    mutationFn: () => {
      const value: Record<string, unknown> = {
        voice_wake_word: wakeWord.trim().toLowerCase(),
        voice_mic_device: micDevice.trim(),
        voice_playback_device: playbackDevice.trim(),
        voice_speech_rms_threshold: speechThreshold.trim() ? Number(speechThreshold.trim()) : '',
      };
      if (groqKey.trim()) value.groq_api_key = groqKey.trim(); // omit when blank -> keeps existing key
      return api.setConfig('general', value);
    },
    onSuccess: () => {
      toast.success('Voice control settings saved — restart the backend to pick up changes');
      setGroqKey('');
      qc.invalidateQueries({ queryKey: ['config-general'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Save failed'),
  });

  // Polls while this card is on screen - saying the wake word and
  // watching enabled/listening/last_command_text update live is the
  // actual test, not a one-shot button press.
  const status = useQuery({
    queryKey: ['voice-control-status'],
    queryFn: api.voiceControlStatus,
    enabled: !isDemo,
    refetchInterval: 4000,
  });

  // Manual test - the same pipeline the wake word triggers, without
  // needing the wake word itself to fire. Only needs the Groq key, so
  // the actual pipeline can be proven right away rather than waiting
  // on the wake-word listener or a backend restart.
  const test = useMutation({
    mutationFn: api.voiceControlTest,
    onSuccess: (data) => qc.setQueryData(['voice-control-status'], data),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Test failed'),
  });

  // Makes the Pi say the wake word, pause, then this command, through
  // its own speaker - two separate clips with a real gap, not one
  // continuous phrase (see api.ts's own comment for why that matters).
  // Built specifically so testing a change doesn't require being
  // physically in the van.
  const [speakTestCommand, setSpeakTestCommand] = useState('turn the lights on');
  const speakTest = useMutation({
    mutationFn: () => api.voiceControlSpeakTest(speakTestCommand),
    onSuccess: (data) => qc.setQueryData(['voice-control-status'], data),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Speak-test failed'),
  });

  return (
    <GlassCard className="col-span-12 lg:col-span-6 p-6">
      <CardHeader label="Voice control" hint="Ron, by voice — say the wake word, then a command" />
      <div className="text-[11px] text-ink-faint mb-3">
        Wake word listening runs locally, free, no account needed (Vosk). Everything after that — hearing what you
        said, deciding what to do, replying out loud — goes through Groq, so it needs a connection to actually do
        anything, same as Ron's text chat.
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] uppercase tracking-widest text-ink-muted">Groq API key</label>
          <input
            type="password"
            value={groqKey}
            onChange={(e) => setGroqKey(e.target.value)}
            placeholder={groqKeySet ? '•••••••• set — blank keeps it' : 'from console.groq.com'}
            className="mt-1.5 w-full rounded-xl bg-ink/[0.04] ring-1 ring-ink/10 focus:ring-aurora-teal/50 outline-none px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-widest text-ink-muted">Wake word</label>
          <input
            value={wakeWord}
            onChange={(e) => setWakeWord(e.target.value)}
            placeholder="computer"
            className="mt-1.5 w-full rounded-xl bg-ink/[0.04] ring-1 ring-ink/10 focus:ring-aurora-teal/50 outline-none px-3 py-2 text-sm"
          />
        </div>
      </div>
      <div className="text-[11px] text-ink-faint mt-1 mb-3">
        Groq's free tier easily covers this app's usage — no card needed. The wake word is just a phrase Vosk
        listens for, so "Ron" works fine too — no training step required.
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] uppercase tracking-widest text-ink-muted">Mic device (ALSA)</label>
          <input
            value={micDevice}
            onChange={(e) => setMicDevice(e.target.value)}
            placeholder="e.g. hw:2,0 — see arecord -l"
            className="mt-1.5 w-full rounded-xl bg-ink/[0.04] ring-1 ring-ink/10 focus:ring-aurora-teal/50 outline-none px-3 py-2 text-sm num"
          />
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-widest text-ink-muted">Speaker device (ALSA)</label>
          <input
            value={playbackDevice}
            onChange={(e) => setPlaybackDevice(e.target.value)}
            placeholder="e.g. hw:1,0 — see aplay -l"
            className="mt-1.5 w-full rounded-xl bg-ink/[0.04] ring-1 ring-ink/10 focus:ring-aurora-teal/50 outline-none px-3 py-2 text-sm num"
          />
        </div>
      </div>
      <div className="text-[11px] text-ink-faint mt-1 mb-3">
        Leave blank for ALSA's own default — used for recording commands and speaking replies. The always-on wake-word
        listener finds the mic itself automatically (no config needed there), so this field doesn't need to match a
        specific format for it.
      </div>

      <div>
        <label className="text-[11px] uppercase tracking-widest text-ink-muted">Speech detection threshold</label>
        <input
          value={speechThreshold}
          onChange={(e) => setSpeechThreshold(e.target.value)}
          placeholder="400 (default)"
          inputMode="numeric"
          className="mt-1.5 w-full max-w-[200px] rounded-xl bg-ink/[0.04] ring-1 ring-ink/10 focus:ring-aurora-teal/50 outline-none px-3 py-2 text-sm num"
        />
      </div>
      <div className="text-[11px] text-ink-faint mt-1 mb-3">
        How loud counts as "someone's talking" while recording a command — lower catches quieter speech but risks
        picking up background noise as speech; higher is more forgiving of noise but might cut off a quiet start. 400
        is a reasonable starting point, not a verified number for your actual mic — worth adjusting from real
        testing if commands keep getting cut off early, or keep running to the full length even for short phrases.
      </div>

      <button
        type="button"
        onClick={() => save.mutate()}
        disabled={save.isPending}
        className="rounded-full px-4 py-2 text-xs font-medium bg-ink/[0.04] ring-1 ring-ink/10 text-ink-soft hover:bg-ink/[0.08] disabled:opacity-40 mb-4"
      >
        Save voice settings
      </button>

      {!isDemo && (
        <div className="mb-4">
          <button
            type="button"
            onClick={() => { toast(`Recording ${5}s — talk now…`); test.mutate(); }}
            disabled={test.isPending}
            className="rounded-full px-4 py-2 text-sm bg-aurora-purple text-white font-semibold hover:brightness-110 disabled:opacity-40 inline-flex items-center gap-2"
          >
            {test.isPending ? <Loader2 size={14} className="animate-spin" /> : <Radio size={14} />}
            {test.isPending ? 'Recording — talk now…' : 'Test the pipeline now'}
          </button>
          <div className="text-[11px] text-ink-faint mt-1.5">
            Skips the wake word entirely — records for 5 seconds starting the instant you tap this, then runs the
            real pipeline (Groq transcribes it, matches a relay command or asks Ron, speaks the reply). Only needs
            the Groq key above — the wake-word listener doesn't need to be running for this to work.
          </div>
        </div>
      )}

      {!isDemo && (
        <div className="mb-2 pt-4 border-t border-ink/10">
          <div className="text-[11px] uppercase tracking-widest text-ink-muted mb-1.5">Test without going to the van</div>
          <div className="flex items-center gap-2 flex-wrap text-sm mb-2">
            <span className="text-ink-muted">Says</span>
            <span className="rounded-full px-2.5 py-1 bg-ink/[0.06] text-ink-soft">"{wakeWord || 'computer'}"</span>
            <span className="text-ink-muted">— pauses — then:</span>
          </div>
          <div className="flex gap-2">
            <input
              value={speakTestCommand}
              onChange={(e) => setSpeakTestCommand(e.target.value)}
              placeholder="turn the lights on"
              className="flex-1 rounded-xl bg-ink/[0.04] ring-1 ring-ink/10 focus:ring-aurora-purple/50 outline-none px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => speakTest.mutate()}
              disabled={speakTest.isPending || !speakTestCommand.trim()}
              className="rounded-full px-4 py-2 text-sm bg-ink/[0.04] ring-1 ring-ink/10 text-ink-soft hover:bg-ink/[0.08] disabled:opacity-40 inline-flex items-center gap-2 shrink-0"
            >
              {speakTest.isPending ? <Loader2 size={14} className="animate-spin" /> : <Volume2 size={14} />}
              Play through speaker
            </button>
          </div>
          <div className="text-[11px] text-ink-faint mt-1.5">
            Speaks the wake word and this command as two separate clips with a real pause between them — a single
            continuous phrase has no gap at all, same problem as rushing the two together yourself. If the mic's
            close enough to hear the speaker (usually true — they're in the same space), the real wake word and
            command pipeline fires exactly as if you'd said it yourself, no need to actually be there. Check the
            status below afterward to see what happened.
          </div>
        </div>
      )}

      {!isDemo && status.data && (
        <div className="rounded-xl bg-ink/[0.03] ring-1 ring-ink/10 p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusPill
              tone={
                !status.data.configured
                  ? 'slate'
                  : !status.data.enabled && status.data.last_error
                    ? 'red'
                    : status.data.listening
                      ? 'teal'
                      : 'amber'
              }
            >
              {!status.data.configured
                ? 'NOT CONFIGURED'
                : !status.data.enabled && status.data.last_error
                  ? 'STOPPED — SEE ERROR'
                  : status.data.processing
                    ? 'THINKING…'
                    : status.data.listening
                      ? 'LISTENING'
                      : 'STARTING…'}
            </StatusPill>
            <span className="text-[11px] text-ink-faint">
              wake word: <span className="text-ink-soft">"{status.data.wake_word}"</span>
            </span>
          </div>
          {status.data.voice_controllable_relays.length > 0 && (
            <div className="text-[11px] text-ink-faint">
              Can say: turn the <span className="text-ink-soft">{status.data.voice_controllable_relays.join(', ')}</span> on/off
              — nothing else, never the roof.
            </div>
          )}
          {status.data.last_command_text && (
            <div className="text-xs text-ink-soft">Last heard: <span className="italic">"{status.data.last_command_text}"</span></div>
          )}
          {status.data.last_reply_text && (
            <div className="text-xs text-ink-soft">Last said: <span className="italic">"{status.data.last_reply_text}"</span></div>
          )}
          {status.data.last_error && (
            <div className="text-xs text-status-amber">{status.data.last_error}</div>
          )}
        </div>
      )}
    </GlassCard>
  );
}

/**
 * Plays a streaming internet radio station through the van's speaker -
 * the same one the voice pipeline talks through (voice_playback_device
 * on the backend; not duplicated here, this card only edits the
 * stream URL). Ron ducks it automatically around his own replies -
 * nothing to configure for that here, it's handled entirely on the
 * backend (internet_radio_service.py).
 */
function InternetRadioCard() {
  const qc = useQueryClient();
  const [streamUrl, setStreamUrl] = useState('');
  const [seeded, setSeeded] = useState(false);

  const status = useQuery({
    queryKey: ['internet-radio-status'],
    queryFn: api.internetRadioStatus,
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (status.data && !seeded) {
      setStreamUrl(status.data.configured_stream_url);
      setSeeded(true);
    }
  }, [status.data, seeded]);

  const saveUrl = useMutation({
    mutationFn: () => api.setConfig('general', { internet_radio_stream_url: streamUrl.trim() }),
    onSuccess: () => {
      toast.success('Stream URL saved');
      qc.invalidateQueries({ queryKey: ['internet-radio-status'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Save failed'),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['internet-radio-status'] });
  const play = useMutation({ mutationFn: () => api.internetRadioPlay(), onSuccess: invalidate, onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not play') });
  const pause = useMutation({ mutationFn: () => api.internetRadioPause(), onSuccess: invalidate, onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not pause') });
  const resume = useMutation({ mutationFn: () => api.internetRadioResume(), onSuccess: invalidate, onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not resume') });
  const stop = useMutation({ mutationFn: () => api.internetRadioStop(), onSuccess: invalidate, onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not stop') });

  const playing = status.data?.playing ?? false;
  const running = status.data?.running ?? false;

  return (
    <GlassCard className="col-span-12 p-6" data-testid={SET.internetRadio}>
      <CardHeader
        label="Internet radio"
        hint="streams through the same speaker as Ron's voice - pauses automatically while he talks"
        right={
          <StatusPill tone={playing ? 'teal' : 'slate'} dot={playing}>
            {playing ? 'PLAYING' : running ? 'PAUSED' : 'STOPPED'}
          </StatusPill>
        }
      />
      <div className="rounded-xl bg-ink/[0.03] ring-1 ring-ink/10 p-4">
        <label className="text-[11px] uppercase tracking-widest text-ink-muted flex items-center gap-1.5">
          <Radio size={12} /> Stream URL
        </label>
        <div className="mt-2 flex flex-col sm:flex-row gap-2">
          <input
            value={streamUrl}
            onChange={(e) => setStreamUrl(e.target.value)}
            placeholder="https://radio.example.com/listen/station/radio.mp3"
            className="flex-1 min-w-0 rounded-xl bg-ink/[0.04] ring-1 ring-ink/10 focus:ring-aurora-teal/50 outline-none px-3 py-2 text-sm num"
          />
          <button
            type="button"
            onClick={() => saveUrl.mutate()}
            disabled={saveUrl.isPending || streamUrl.trim() === status.data?.configured_stream_url}
            className="shrink-0 rounded-full px-4 py-2 text-sm bg-ink/[0.06] ring-1 ring-ink/10 hover:bg-ink/[0.1] disabled:opacity-40"
          >
            {saveUrl.isPending ? 'Saving…' : 'Save URL'}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {playing ? (
            <button
              type="button"
              onClick={() => pause.mutate()}
              disabled={pause.isPending}
              className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm bg-aurora-teal text-navy-900 font-semibold hover:brightness-110 disabled:opacity-40"
            >
              <Pause size={14} /> Pause
            </button>
          ) : running ? (
            <button
              type="button"
              onClick={() => resume.mutate()}
              disabled={resume.isPending}
              className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm bg-aurora-teal text-navy-900 font-semibold hover:brightness-110 disabled:opacity-40"
            >
              <Play size={14} /> Resume
            </button>
          ) : (
            <button
              type="button"
              onClick={() => play.mutate()}
              disabled={play.isPending}
              className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm bg-aurora-teal text-navy-900 font-semibold hover:brightness-110 disabled:opacity-40"
            >
              <Play size={14} /> Play
            </button>
          )}
          <button
            type="button"
            onClick={() => stop.mutate()}
            disabled={stop.isPending || !running}
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm bg-ink/[0.06] ring-1 ring-ink/10 hover:bg-ink/[0.1] disabled:opacity-40"
          >
            <Square size={14} /> Stop
          </button>
        </div>
        {status.data?.stream_url && (
          <div className="text-[11px] text-ink-faint mt-3 truncate">Now on air: <span className="num">{status.data.stream_url}</span></div>
        )}
      </div>
    </GlassCard>
  );
}

export function Settings() {
  const qc = useQueryClient();
  const { theme, toggle } = useTheme();
  const [distanceUnit, setDistanceUnitState] = useState<'mi' | 'km'>(() => getDistanceUnit());
  const [pwSsid, setPwSsid] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const pwBoxRef = useRef<HTMLDivElement | null>(null);

  const wifi = useQuery({ queryKey: ['wifi-status'], queryFn: api.wifiStatus, refetchInterval: 8000 });
  const scan = useQuery({ queryKey: ['wifi-scan'], queryFn: api.wifiScan });
  const plugins = useQuery({ queryKey: ['plugins'], queryFn: api.plugins, refetchInterval: 12000 });

  const connect = useMutation({
    mutationFn: ({ ssid, password }: { ssid: string; password?: string }) => api.wifiConnect(ssid, password),
    onSuccess: (d) => {
      toast.success(`Connected to ${d.connected_to}`);
      qc.invalidateQueries({ queryKey: ['wifi-status'] });
      qc.invalidateQueries({ queryKey: ['wifi-scan'] });
      setPwSsid(null); setPw('');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Connection failed'),
  });

  const togglePlugin = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      enabled ? api.enablePlugin(name) : api.disablePlugin(name),
    onSuccess: (_d, { name, enabled }) => {
      toast.success(`${name} ${enabled ? 'enabled' : 'disabled'}`);
      qc.invalidateQueries({ queryKey: ['plugins'] });
      // Weather/telemetry queries only start returning data once their
      // plugin is actually running, so refresh those too.
      qc.invalidateQueries({ queryKey: ['weather'] });
    },
    onError: () => toast.error('Could not update plugin'),
  });

  // Backup/restore of data/config.json + data/vanos.db.
  const restoreFileRef = useRef<HTMLInputElement | null>(null);
  const restore = useMutation({
    mutationFn: (file: File) => api.restoreBackup(file),
    onSuccess: (d) => toast.success(d.message, { duration: 6000 }),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Restore failed'),
  });
  const onRestoreFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // let choosing the same filename again re-trigger onChange
    if (!file) return;
    if (!window.confirm('This replaces the current config and database with the backup, then restarts the app. Continue?')) return;
    restore.mutate(file);
  };

  // Integrations — operator's own contact email (for OpenStreetMap) and
  // Anthropic API key (for AI picks). Stored in the config store, never
  // hardcoded to anyone. The key is write-only: the API returns it blank.
  const cfg = useQuery({ queryKey: ['config-general'], queryFn: () => api.getConfig('general') });
  const [contact, setContact] = useState('');
  const [aiKey, setAiKey] = useState('');
  const [aiModel, setAiModel] = useState('');
  // NOT write-only like the Anthropic key: a Google Maps JS API key has to
  // reach the browser to load the map at all, so hiding it here wouldn't
  // hide it from anyone - it's visible in the page's network requests the
  // moment the map loads. Restrict it by HTTP referrer in Google Cloud
  // Console instead; that's the actual security boundary for this kind of
  // key, not secrecy.
  const [mapsKey, setMapsKey] = useState('');
  // Ofcom Connected Nations key — powers the Coverage page. Write-only,
  // same as the Anthropic key: it's a metered credential and this app is
  // reachable over the internet through the tunnel.
  const [ofcomKey, setOfcomKey] = useState('');
  // Which network gets top billing on the Coverage page. Ofcom's own
  // operator prefixes, not friendly names, so the value round-trips
  // straight into their response fields.
  const [homeNetwork, setHomeNetwork] = useState('H3');
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (cfg.data && !seeded) {
      setContact(String(cfg.data.contact_email ?? ''));
      setAiModel(String(cfg.data.ai_model ?? ''));
      setMapsKey(String(cfg.data.google_maps_api_key ?? ''));
      setHomeNetwork(String(cfg.data.home_network ?? 'H3'));
      setSeeded(true);
    }
  }, [cfg.data, seeded]);
  const keySet = cfg.data?.anthropic_api_key_set === true;
  const ofcomKeySet = cfg.data?.ofcom_api_key_set === true;

  const saveCfg = useMutation({
    mutationFn: () => {
      const value: Record<string, unknown> = {
        contact_email: contact.trim(),
        ai_model: aiModel.trim(),
        google_maps_api_key: mapsKey.trim(),
        home_network: homeNetwork,
      };
      if (aiKey.trim()) value.anthropic_api_key = aiKey.trim(); // omit when blank -> leaves existing key
      if (ofcomKey.trim()) value.ofcom_api_key = ofcomKey.trim(); // same rule
      return api.setConfig('general', value);
    },
    onSuccess: () => {
      toast.success('Integrations saved');
      setAiKey('');
      setOfcomKey('');
      qc.invalidateQueries({ queryKey: ['config-general'] });
      qc.invalidateQueries({ queryKey: ['ai-status'] });
      qc.invalidateQueries({ queryKey: ['coverage-status'] });
    },
    onError: () => toast.error('Could not save'),
  });

  const st = wifi.data;
  const nets = scan.data?.networks || [];
  const p = plugins.data ?? [];

  return (
    <div data-testid={SET.root} className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 py-6 lg:py-10">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-ink-muted">Settings</div>
          <h1 className="text-3xl md:text-5xl font-semibold tracking-tight mt-1">Systems under the <span className="text-aurora-teal">hood</span></h1>
          <div className="text-sm text-ink-muted mt-2">Network, appearance and plugin health.</div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4 lg:gap-6">
        <GlassCard className="col-span-12 lg:col-span-5 p-6">
          <CardHeader label="Appearance" hint="dark by default · light for daylight glare" />
          <div className="rounded-xl bg-ink/[0.03] ring-1 ring-ink/10 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {theme === 'light' ? <Sun size={16} className="text-aurora-teal" /> : <Moon size={16} className="text-aurora-purple" />}
              <div>
                <div className="text-sm">Theme</div>
                <div className="text-[11px] text-ink-faint">Toggles instantly · persisted to localStorage.</div>
              </div>
            </div>
            <button
              data-testid={SET.themeToggle}
              type="button"
              onClick={toggle}
              className={cn('relative h-7 w-12 rounded-full transition', theme === 'dark' ? 'bg-aurora-purple/40 ring-1 ring-aurora-purple/50' : 'bg-aurora-teal/40 ring-1 ring-aurora-teal/50')}
            >
              <span className={cn('absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform', theme === 'dark' ? 'left-0.5' : 'left-[calc(100%-1.625rem)]')} />
            </button>
          </div>
          <div className="rounded-xl bg-ink/[0.03] ring-1 ring-ink/10 px-4 py-3 flex items-center justify-between mt-3">
            <div className="flex items-center gap-3">
              <Navigation size={16} className="text-aurora-teal" />
              <div>
                <div className="text-sm">Distance unit</div>
                <div className="text-[11px] text-ink-faint">Trip totals, POI distances. Miles by default.</div>
              </div>
            </div>
            <div className="flex rounded-full ring-1 ring-ink/10 overflow-hidden text-xs font-medium">
              <button
                type="button"
                onClick={() => { setDistanceUnit('mi'); setDistanceUnitState('mi'); }}
                className={cn('px-3 py-1.5', distanceUnit === 'mi' ? 'bg-aurora-teal text-navy-900' : 'bg-transparent text-ink-soft hover:bg-ink/[0.05]')}
              >
                Miles
              </button>
              <button
                type="button"
                onClick={() => { setDistanceUnit('km'); setDistanceUnitState('km'); }}
                className={cn('px-3 py-1.5', distanceUnit === 'km' ? 'bg-aurora-teal text-navy-900' : 'bg-transparent text-ink-soft hover:bg-ink/[0.05]')}
              >
                Km
              </button>
            </div>
          </div>
        </GlassCard>

        <CollapsibleGroup title="Connectivity & location" hint="WiFi, modem signal, GPS position, offline maps">
        <GlassCard className="col-span-12 lg:col-span-7 p-6" data-testid={SET.wifiList}>
          <CardHeader
            label="WiFi networks"
            hint={st?.ip ? `IP ${st.ip}` : ''}
            right={
              <button
                type="button"
                data-testid={SET.wifiScan}
                onClick={() => scan.refetch()}
                className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs bg-ink/[0.04] ring-1 ring-ink/10 text-ink-soft hover:bg-ink/[0.08]"
              >
                {scan.isFetching ? <Loader2 size={14} className="animate-spin" /> : <Radio size={14} />} Scan
              </button>
            }
          />
          {scan.isError && (
            <div className="mb-3 rounded-2xl p-3 bg-red-500/10 ring-1 ring-red-500/30 text-xs text-red-200">
              Scan failed: {scan.error instanceof Error ? scan.error.message : 'unknown error'}
            </div>
          )}
          {!scan.isError && !scan.isFetching && nets.length === 0 && (
            <div className="mb-3 text-xs text-ink-faint">No networks found. Try Scan again, or check the Pi has WiFi hardware enabled.</div>
          )}
          <ul className="divide-y divide-ink/5">
            {nets.map((n) => (
              <li key={n.ssid} className="flex items-center gap-3 py-3">
                {n.current ? <Wifi size={18} className="text-aurora-teal" /> : <WifiOff size={18} className="text-ink-faint" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium truncate">{n.ssid}</div>
                    {n.secured && <Lock size={12} className="text-ink-faint" />}
                    {n.current && <StatusPill tone="teal">Current</StatusPill>}
                    {!n.current && st?.known_networks?.includes(n.ssid) && (
                      <span className="text-[10px] uppercase tracking-wide text-ink-faint ring-1 ring-ink/15 rounded-full px-2 py-0.5">
                        Saved
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-ink-faint num">signal {n.signal} dBm</div>
                </div>
                <Bars dbm={n.signal} />
                {!n.current && (
                  <button
                    type="button"
                    onClick={() => {
                      if (n.secured) {
                        setPwSsid(n.ssid);
                        setPw('');
                        // Secured networks need a password typed in below -
                        // this button does NOT connect on its own for those.
                        // Without this, that second step is easy to miss
                        // entirely and just looks like the click did nothing.
                        requestAnimationFrame(() => pwBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
                      } else {
                        connect.mutate({ ssid: n.ssid });
                      }
                    }}
                    className="ml-2 text-xs rounded-full px-3 py-1.5 bg-aurora-teal/15 text-aurora-teal ring-1 ring-aurora-teal/40 hover:bg-aurora-teal/25"
                  >
                    Connect
                  </button>
                )}
              </li>
            ))}
          </ul>

          {pwSsid && (
            <div ref={pwBoxRef} className="mt-4 rounded-2xl p-4 bg-ink/[0.03] ring-2 ring-aurora-teal/50">
              <div className="text-xs text-ink-muted">
                <span className="text-ink font-medium">{pwSsid}</span> needs a password — enter it below, then hit Connect again.
              </div>
              <div className="mt-2 flex gap-2">
                <input
                  autoFocus
                  type="password"
                  placeholder="WiFi password"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && pw) connect.mutate({ ssid: pwSsid, password: pw }); }}
                  className="flex-1 rounded-xl bg-ink/[0.04] ring-1 ring-ink/10 focus:ring-aurora-teal/50 outline-none px-3 py-2 num"
                />
                <button
                  type="button"
                  onClick={() => connect.mutate({ ssid: pwSsid, password: pw })}
                  disabled={!pw || connect.isPending}
                  className="rounded-xl px-3 py-2 text-sm bg-aurora-teal text-navy-900 font-semibold disabled:opacity-40"
                >
                  {connect.isPending ? 'Connecting…' : 'Connect'}
                </button>
                <button type="button" onClick={() => setPwSsid(null)} className="text-xs text-ink-muted px-2">cancel</button>
              </div>
              {connect.isError && (
                <div className="mt-2 text-xs text-red-300">
                  {connect.error instanceof Error ? connect.error.message : 'Connection failed'}
                </div>
              )}
            </div>
          )}
        </GlassCard>

        <ModemDiagnosticsCard />

        <OfflineMapsCard />

        <LocationCard />
        <GpsSatellitesCard />
        </CollapsibleGroup>

        <CollapsibleGroup title="Voice & integrations" hint="API keys, Ron by voice">
        <GlassCard className="col-span-12 p-6">
          <CardHeader label="Integrations" hint="your own contact + AI key — nothing is hardcoded or shared" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="text-[11px] uppercase tracking-widest text-ink-muted flex items-center gap-1.5"><Mail size={12} /> Contact email (maps)</label>
              <input
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="you@example.com"
                className="mt-2 w-full rounded-xl bg-ink/[0.04] ring-1 ring-ink/10 focus:ring-aurora-teal/50 outline-none px-3 py-2 text-sm"
              />
              <div className="text-[11px] text-ink-faint mt-1">Sent to OpenStreetMap as a contact, per their usage policy. Not shared anywhere else.</div>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-widest text-ink-muted flex items-center gap-1.5"><KeyRound size={12} /> Anthropic API key</label>
              <input
                type="password"
                value={aiKey}
                onChange={(e) => setAiKey(e.target.value)}
                placeholder={keySet ? '•••••••• set — blank keeps it' : 'sk-ant-…'}
                className="mt-2 w-full rounded-xl bg-ink/[0.04] ring-1 ring-ink/10 focus:ring-aurora-teal/50 outline-none px-3 py-2 text-sm num"
              />
              <div className="text-[11px] text-ink-faint mt-1">{keySet ? 'A key is stored. Enter a new one to replace it.' : 'Optional — enables the AI “what’s nearby” picks.'}</div>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-widest text-ink-muted flex items-center gap-1.5"><Sparkles size={12} /> AI model (optional)</label>
              <input
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                placeholder="claude-haiku-4-5-20251001"
                className="mt-2 w-full rounded-xl bg-ink/[0.04] ring-1 ring-ink/10 focus:ring-aurora-teal/50 outline-none px-3 py-2 text-sm num"
              />
              <div className="text-[11px] text-ink-faint mt-1">Leave blank for the default (cheapest Haiku).</div>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-widest text-ink-muted flex items-center gap-1.5"><MapPin size={12} /> Google Maps API key</label>
              <input
                value={mapsKey}
                onChange={(e) => setMapsKey(e.target.value)}
                placeholder="AIza…"
                className="mt-2 w-full rounded-xl bg-ink/[0.04] ring-1 ring-ink/10 focus:ring-aurora-teal/50 outline-none px-3 py-2 text-sm num"
              />
              <div className="text-[11px] text-ink-faint mt-1">
                Optional — Trips/Nearby fall back to the built-in map without one. Restrict it by HTTP referrer in Google
                Cloud Console; this key is visible in the browser by design.
              </div>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-widest text-ink-muted flex items-center gap-1.5"><SignalHigh size={12} /> Ofcom API key</label>
              <input
                type="password"
                value={ofcomKey}
                onChange={(e) => setOfcomKey(e.target.value)}
                placeholder={ofcomKeySet ? '•••••••• set — blank keeps it' : 'Ofcom subscription key'}
                className="mt-2 w-full rounded-xl bg-ink/[0.04] ring-1 ring-ink/10 focus:ring-aurora-teal/50 outline-none px-3 py-2 text-sm num"
              />
              <div className="text-[11px] text-ink-faint mt-1">
                {ofcomKeySet ? 'A key is stored. Enter a new one to replace it.' : 'Enables the Coverage page. Free from api.ofcom.org.uk — the Connected Nations Mobile API.'}
              </div>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-widest text-ink-muted flex items-center gap-1.5"><SignalHigh size={12} /> Your mobile network</label>
              <select
                value={homeNetwork}
                onChange={(e) => setHomeNetwork(e.target.value)}
                className="mt-2 w-full rounded-xl bg-ink/[0.04] ring-1 ring-ink/10 focus:ring-aurora-teal/50 outline-none px-3 py-2 text-sm"
              >
                <option value="H3">Three</option>
                <option value="EE">EE</option>
                <option value="TF">O2</option>
                <option value="VO">Vodafone</option>
              </select>
              <div className="text-[11px] text-ink-faint mt-1">Shown first and largest on the Coverage page. The other three are still listed.</div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => saveCfg.mutate()}
              disabled={saveCfg.isPending}
              className="rounded-full px-4 py-2 text-sm bg-aurora-teal text-navy-900 font-semibold hover:brightness-110 disabled:opacity-40"
            >
              {saveCfg.isPending ? 'Saving…' : 'Save integrations'}
            </button>
            <span className="text-[11px] text-ink-faint">Stored on the Pi in <span className="num">data/config.json</span>. The API key is write-only — the app never sends it back.</span>
          </div>
        </GlassCard>

        <VoiceControlCard />
        <InternetRadioCard />
        </CollapsibleGroup>

        <CollapsibleGroup title="System & data" hint="plugin health, relay audit log, backup">
        <RelayEventLog />

        <GlassCard className="col-span-12 p-6" data-testid={SET.pluginsList}>
          <CardHeader label="Plugin health" hint={`${p.length} loaded`} />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {p.map((plg) => (
              <div
                key={plg.name}
                className={cn(
                  'rounded-2xl p-4 ring-1 ring-inset',
                  plg.status === 'running'
                    ? 'bg-emerald-500/5 ring-emerald-400/20'
                    : plg.status === 'starting'
                      ? 'bg-amber-500/5 ring-amber-400/25'
                      : plg.status === 'disabled' || plg.status === 'stopped'
                        ? 'bg-ink/[0.03] ring-ink/10'
                        : 'bg-red-500/5 ring-red-400/25',
                )}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm font-medium">{plg.display_name || plg.name}</div>
                    <div className="text-[11px] text-ink-faint num mt-0.5">
                      v{plg.version}
                      {plg.device_name ? ` · ${plg.device_name}` : ''}
                    </div>
                  </div>
                  <StatusPill tone={plg.status === 'running' ? 'green' : plg.status === 'starting' ? 'amber' : plg.status === 'disabled' || plg.status === 'stopped' ? 'slate' : 'red'}>
                    {plg.status.toUpperCase()}
                  </StatusPill>
                </div>
                {/* Show the actual error when there is one - it's far more
                    useful than a heartbeat timestamp, and it's how the
                    "no encryption key configured" case surfaces. */}
                {plg.last_error ? (
                  <div className="text-[11px] text-status-red mt-2">{plg.last_error}</div>
                ) : (
                  <div className="text-[11px] text-ink-muted mt-2">
                    {plg.last_heartbeat
                      ? `last seen ${new Date(plg.last_heartbeat * 1000).toLocaleTimeString()}`
                      : 'no data yet'}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => togglePlugin.mutate({ name: plg.name, enabled: !plg.enabled })}
                  disabled={togglePlugin.isPending}
                  className="mt-3 w-full rounded-lg py-1.5 text-[12px] font-medium bg-ink/[0.05] hover:bg-ink/[0.09] ring-1 ring-inset ring-ink/10 disabled:opacity-50 transition"
                >
                  {plg.enabled ? 'Disable' : 'Enable'}
                </button>
              </div>
            ))}
            {p.length === 0 && <div className="col-span-full text-sm text-ink-muted">No plugin data.</div>}
          </div>
        </GlassCard>

        <GlassCard className="col-span-12 lg:col-span-6 p-6" data-testid={SET.backup}>
          <CardHeader label="Backup & restore" hint="config + database" right={<Download size={16} className="text-aurora-teal" />} />
          {isDemo ? (
            <div className="mt-3 text-sm text-ink-muted">Not available in the browser demo — this is real on your Pi.</div>
          ) : (
            <>
              <div className="mt-3 text-sm text-ink-muted">
                Downloads <span className="num">config.json</span> and <span className="num">vanos.db</span> as a single zip — relay
                names, wifi, integrations, and all your telemetry/location/places history.
              </div>
              <a
                href={api.backupUrl() ?? undefined}
                className="mt-4 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium bg-aurora-teal/15 text-aurora-teal ring-1 ring-inset ring-aurora-teal/40 hover:bg-aurora-teal/20 transition"
              >
                <Download size={14} /> Download backup
              </a>

              <div className="mt-5 pt-5 border-t border-ink/10">
                <div className="text-sm text-ink-muted">
                  Restoring replaces the current config and database, then restarts the app — use this after a reinstall to get
                  everything back.
                </div>
                <input ref={restoreFileRef} type="file" accept=".zip" className="hidden" onChange={onRestoreFileChosen} />
                <button
                  type="button"
                  onClick={() => restoreFileRef.current?.click()}
                  disabled={restore.isPending}
                  className="mt-4 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium bg-ink/[0.05] hover:bg-ink/[0.09] ring-1 ring-inset ring-ink/15 disabled:opacity-50 transition"
                >
                  {restore.isPending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  {restore.isPending ? 'Restoring…' : 'Restore from backup'}
                </button>
              </div>
            </>
          )}
        </GlassCard>
        </CollapsibleGroup>
      </div>
    </div>
  );
}
