import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Wifi, WifiOff, Lock, Loader2, Radio, Sun, Moon, Mail, KeyRound, Sparkles, MapPin, LocateFixed, Globe } from 'lucide-react';
import { GlassCard, CardHeader } from '@/components/primitives/GlassCard';
import { StatusPill } from '@/components/primitives/StatusPill';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import { signalToBars } from '@/lib/format';
import { SET } from '@/constants/testIds';
import { cn } from '@/lib/utils';

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
  const [busy, setBusy] = useState(false);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');

  const loc = useQuery({ queryKey: ['location'], queryFn: api.location, retry: false });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['location'] });
    qc.invalidateQueries({ queryKey: ['weather'] });
    qc.invalidateQueries({ queryKey: ['poi-nearby'] });
  };

  const useGps = () => {
    // Geolocation is disabled entirely on insecure (http) origins, and the
    // old code swallowed the failure — which is exactly why "refresh" just
    // spun and did nothing. Tell the user instead.
    if (!window.isSecureContext || !navigator.geolocation) {
      toast.error('GPS needs the https address — or set it manually below.');
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await api.setLocation(pos.coords.latitude, pos.coords.longitude);
          toast.success('Location set from GPS');
          refresh();
        } catch {
          toast.error('Got your location, but could not save it to the van.');
        } finally {
          setBusy(false);
        }
      },
      (err) => {
        setBusy(false);
        toast.error(err.code === err.PERMISSION_DENIED ? 'Location permission denied.' : "Couldn't get your GPS location.");
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
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
        </div>
      ) : (
        <div className="text-sm text-ink-muted">No location set yet — set it with GPS, manually, or the internet.</div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={useGps}
          disabled={busy}
          data-testid={SET.locationGps}
          className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm bg-aurora-teal text-navy-900 font-semibold hover:brightness-110 disabled:opacity-40"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <LocateFixed size={14} />} Use my GPS
        </button>
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

export function Settings() {
  const qc = useQueryClient();
  const { theme, toggle } = useTheme();
  const [pwSsid, setPwSsid] = useState<string | null>(null);
  const [pw, setPw] = useState('');

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
    onError: () => toast.error('Connection failed'),
  });

  // Integrations — operator's own contact email (for OpenStreetMap) and
  // Anthropic API key (for AI picks). Stored in the config store, never
  // hardcoded to anyone. The key is write-only: the API returns it blank.
  const cfg = useQuery({ queryKey: ['config-general'], queryFn: () => api.getConfig('general') });
  const [contact, setContact] = useState('');
  const [aiKey, setAiKey] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (cfg.data && !seeded) {
      setContact(String(cfg.data.contact_email ?? ''));
      setAiModel(String(cfg.data.ai_model ?? ''));
      setSeeded(true);
    }
  }, [cfg.data, seeded]);
  const keySet = cfg.data?.anthropic_api_key_set === true;

  const saveCfg = useMutation({
    mutationFn: () => {
      const value: Record<string, unknown> = { contact_email: contact.trim(), ai_model: aiModel.trim() };
      if (aiKey.trim()) value.anthropic_api_key = aiKey.trim(); // omit when blank -> leaves existing key
      return api.setConfig('general', value);
    },
    onSuccess: () => {
      toast.success('Integrations saved');
      setAiKey('');
      qc.invalidateQueries({ queryKey: ['config-general'] });
      qc.invalidateQueries({ queryKey: ['ai-status'] });
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
        <StatusPill tone={st?.connected ? 'teal' : 'red'}>{st?.connected ? `CONNECTED · ${st?.ssid ?? ''}` : 'OFFLINE'}</StatusPill>
      </div>

      <div className="grid grid-cols-12 gap-4 lg:gap-6">
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
          <ul className="divide-y divide-ink/5">
            {nets.map((n) => (
              <li key={n.ssid} className="flex items-center gap-3 py-3">
                {n.current ? <Wifi size={18} className="text-aurora-teal" /> : <WifiOff size={18} className="text-ink-faint" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium truncate">{n.ssid}</div>
                    {n.secured && <Lock size={12} className="text-ink-faint" />}
                    {n.current && <StatusPill tone="teal">Current</StatusPill>}
                  </div>
                  <div className="text-[11px] text-ink-faint num">signal {n.signal} dBm</div>
                </div>
                <Bars dbm={n.signal} />
                {!n.current && (
                  <button
                    type="button"
                    onClick={() => (n.secured ? setPwSsid(n.ssid) : connect.mutate({ ssid: n.ssid }))}
                    className="ml-2 text-xs rounded-full px-3 py-1.5 bg-aurora-teal/15 text-aurora-teal ring-1 ring-aurora-teal/40 hover:bg-aurora-teal/25"
                  >
                    Connect
                  </button>
                )}
              </li>
            ))}
          </ul>

          {pwSsid && (
            <div className="mt-4 rounded-2xl p-4 bg-ink/[0.03] ring-1 ring-ink/10">
              <div className="text-xs text-ink-muted">Password for <span className="text-ink">{pwSsid}</span></div>
              <div className="mt-2 flex gap-2">
                <input
                  type="password"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
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
            </div>
          )}
        </GlassCard>

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
        </GlassCard>

        <LocationCard />

        <GlassCard className="col-span-12 p-6">
          <CardHeader label="Integrations" hint="your own contact + AI key — nothing is hardcoded or shared" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
              </div>
            ))}
            {p.length === 0 && <div className="col-span-full text-sm text-ink-muted">No plugin data.</div>}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
