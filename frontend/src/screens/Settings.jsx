import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Wifi, WifiOff, Lock, Loader2, Cloud, ShieldCheck, Sun, Moon, Radio, ExternalLink,
} from 'lucide-react';
import { endpoints } from '@/lib/api';
import { GlassCard, CardHeader } from '@/components/primitives/GlassCard';
import { StatusPill } from '@/components/primitives/StatusPill';
import { SET } from '@/constants/testIds';
import { signalToBars } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

const Bars = ({ dbm }) => {
  const bars = signalToBars(dbm);
  return (
    <div className="flex items-end gap-0.5 h-4">
      {[1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={cn(
            'w-1 rounded-sm',
            i <= bars ? 'bg-aurora-teal' : 'bg-white/15',
          )}
          style={{ height: `${i * 25}%` }}
        />
      ))}
    </div>
  );
};

export const Settings = () => {
  const qc = useQueryClient();
  const { theme, toggle: toggleTheme } = useTheme();
  const [pwPromptSsid, setPwPromptSsid] = useState(null);
  const [pw, setPw] = useState('');

  const status = useQuery({ queryKey: ['wifi-status'], queryFn: endpoints.wifiStatus, refetchInterval: 8000 });
  const scan = useQuery({ queryKey: ['wifi-scan'], queryFn: endpoints.wifiScan });
  const settings = useQuery({ queryKey: ['settings'], queryFn: endpoints.settings });
  const plugins = useQuery({ queryKey: ['plugins'], queryFn: endpoints.plugins, refetchInterval: 12000 });
  const tunnel = useQuery({ queryKey: ['tunnel'], queryFn: endpoints.tunnelStatus, refetchInterval: 12000 });

  const connect = useMutation({
    mutationFn: ({ ssid, password }) => endpoints.wifiConnect(ssid, password),
    onSuccess: (d) => {
      toast.success(`Connected to ${d.connected_to}`);
      qc.invalidateQueries({ queryKey: ['wifi-status'] });
      qc.invalidateQueries({ queryKey: ['wifi-scan'] });
      setPwPromptSsid(null);
      setPw('');
    },
    onError: () => toast.error('Connection failed'),
  });

  const updateSettings = useMutation({
    mutationFn: (patch) => endpoints.updateSettings(patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  const nets = scan.data?.networks || [];
  const st = status.data;
  const s = settings.data || {};
  const p = plugins.data?.plugins || [];
  const t = tunnel.data;

  return (
    <div data-testid={SET.root} className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 py-6 lg:py-10">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">WiFi + settings</div>
          <h1 className="text-3xl md:text-5xl font-semibold text-white tracking-tight mt-1">
            Systems <span className="text-aurora-teal">under</span> the hood
          </h1>
          <div className="text-sm text-slate-400 mt-2">
            Network, theme, plugin health & remote tunnel — everything at your fingertips.
          </div>
        </div>
        <StatusPill tone={st?.connected ? 'teal' : 'red'}>
          {st?.connected ? `CONNECTED · ${st.ssid}` : 'OFFLINE'}
        </StatusPill>
      </div>

      <div className="grid grid-cols-12 gap-4 lg:gap-6">
        {/* WiFi */}
        <GlassCard className="col-span-12 lg:col-span-7 p-6" data-testid={SET.wifiList}>
          <CardHeader
            label="WiFi networks"
            hint={st ? `IP ${st.ip}` : ''}
            right={
              <button
                type="button"
                data-testid={SET.wifiScanBtn}
                onClick={() => scan.refetch()}
                className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs bg-white/[0.04] ring-1 ring-white/10 text-slate-200 hover:bg-white/[0.08]"
              >
                {scan.isFetching ? <Loader2 size={14} className="animate-spin" /> : <Radio size={14} />} Scan
              </button>
            }
          />
          <ul className="divide-y divide-white/5">
            {nets.map((n) => (
              <li key={n.ssid} className="flex items-center gap-3 py-3">
                {n.current ? <Wifi size={18} className="text-aurora-teal" /> : <WifiOff size={18} className="text-slate-500" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="text-white text-sm font-medium truncate">{n.ssid}</div>
                    {n.secured && <Lock size={12} className="text-slate-500" />}
                    {n.current && <StatusPill tone="teal">Current</StatusPill>}
                  </div>
                  <div className="text-[11px] text-slate-500 num">signal {n.signal} dBm</div>
                </div>
                <Bars dbm={n.signal} />
                {!n.current && (
                  <button
                    type="button"
                    onClick={() => (n.secured ? setPwPromptSsid(n.ssid) : connect.mutate({ ssid: n.ssid, password: null }))}
                    className="ml-2 text-xs rounded-full px-3 py-1.5 bg-aurora-teal/15 text-aurora-teal ring-1 ring-aurora-teal/40 hover:bg-aurora-teal/25"
                  >
                    Connect
                  </button>
                )}
              </li>
            ))}
          </ul>

          {pwPromptSsid && (
            <div className="mt-4 rounded-2xl p-4 bg-white/[0.03] ring-1 ring-white/10">
              <div className="text-xs text-slate-400">Password for <span className="text-white">{pwPromptSsid}</span></div>
              <div className="mt-2 flex gap-2">
                <input
                  type="password"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  className="flex-1 rounded-xl bg-white/[0.04] ring-1 ring-white/10 focus:ring-aurora-teal/50 outline-none px-3 py-2 text-white num"
                />
                <button
                  type="button"
                  onClick={() => connect.mutate({ ssid: pwPromptSsid, password: pw })}
                  disabled={!pw || connect.isPending}
                  className="rounded-xl px-3 py-2 text-sm bg-aurora-teal text-navy-900 font-semibold disabled:opacity-40"
                >
                  {connect.isPending ? 'Connecting…' : 'Connect'}
                </button>
                <button type="button" onClick={() => setPwPromptSsid(null)} className="text-xs text-slate-400 px-2">cancel</button>
              </div>
            </div>
          )}
        </GlassCard>

        {/* Preferences */}
        <div className="col-span-12 lg:col-span-5 space-y-4 lg:space-y-6">
          <GlassCard className="p-6">
            <CardHeader label="Preferences" hint="theme · security" />
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl bg-white/[0.03] ring-1 ring-white/10 px-4 py-3">
                <div className="flex items-center gap-3">
                  {theme === 'light' ? <Sun size={16} className="text-aurora-teal" /> : <Moon size={16} className="text-aurora-purple" />}
                  <div>
                    <div className="text-white text-sm">Theme</div>
                    <div className="text-[11px] text-slate-500">Dark is default cockpit mode · light for daylight glare.</div>
                  </div>
                </div>
                <button
                  data-testid={SET.themeToggle}
                  type="button"
                  onClick={() => {
                    toggleTheme();
                    const next = theme === 'dark' ? 'light' : 'dark';
                    updateSettings.mutate({ theme: next });
                  }}
                  className={cn(
                    'relative h-7 w-12 rounded-full transition',
                    theme === 'dark' ? 'bg-aurora-purple/40 ring-1 ring-aurora-purple/50' : 'bg-aurora-teal/40 ring-1 ring-aurora-teal/50',
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform',
                      theme === 'dark' ? 'left-0.5' : 'left-[calc(100%-1.625rem)]',
                    )}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between rounded-xl bg-white/[0.03] ring-1 ring-white/10 px-4 py-3">
                <div className="flex items-center gap-3">
                  <ShieldCheck size={16} className="text-aurora-teal" />
                  <div>
                    <div className="text-white text-sm">Camera password gate</div>
                    <div className="text-[11px] text-slate-500">Require unlock every session.</div>
                  </div>
                </div>
                <button
                  data-testid={SET.passwordGateToggle}
                  type="button"
                  onClick={() => updateSettings.mutate({ password_gate: !s.password_gate })}
                  className={cn(
                    'relative h-7 w-12 rounded-full transition',
                    s.password_gate ? 'bg-aurora-teal/40 ring-1 ring-aurora-teal/50' : 'bg-white/10 ring-1 ring-white/15',
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform',
                      s.password_gate ? 'left-[calc(100%-1.625rem)]' : 'left-0.5',
                    )}
                  />
                </button>
              </div>
            </div>
          </GlassCard>

          <GlassCard className="p-6" data-testid={SET.tunnelStatus}>
            <CardHeader label="Remote tunnel" hint={t?.provider || ''} right={<StatusPill tone={t?.active ? 'teal' : 'red'}>{t?.active ? 'ONLINE' : 'OFFLINE'}</StatusPill>} />
            <div className="flex items-center gap-3">
              <Cloud size={22} className="text-aurora-teal" />
              <div className="min-w-0 flex-1">
                <a
                  href={t?.public_url || '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="text-white text-sm truncate flex items-center gap-1 hover:text-aurora-teal"
                >
                  {t?.public_url || '—'} <ExternalLink size={12} />
                </a>
                <div className="text-[11px] text-slate-500 num">latency {t?.latency_ms ?? '—'} ms</div>
              </div>
            </div>
          </GlassCard>
        </div>

        {/* Plugins */}
        <GlassCard className="col-span-12 p-6" data-testid={SET.pluginsList}>
          <CardHeader label="Plugin health" hint={`${p.length} loaded`} />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {p.map((plg) => (
              <div
                key={plg.name}
                className={cn(
                  'rounded-2xl p-4 ring-1 ring-inset',
                  plg.status === 'healthy'
                    ? 'bg-emerald-500/5 ring-emerald-400/20'
                    : plg.status === 'degraded'
                    ? 'bg-amber-500/5 ring-amber-400/25'
                    : 'bg-red-500/5 ring-red-400/25',
                )}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-white text-sm font-medium">{plg.name}</div>
                    <div className="text-[11px] text-slate-500 num mt-0.5">v{plg.version}</div>
                  </div>
                  <StatusPill
                    tone={plg.status === 'healthy' ? 'green' : plg.status === 'degraded' ? 'amber' : 'red'}
                  >
                    {plg.status.toUpperCase()}
                  </StatusPill>
                </div>
                <div className="text-[11px] text-slate-400 mt-2">last seen {plg.last_seen}</div>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </div>
  );
};
