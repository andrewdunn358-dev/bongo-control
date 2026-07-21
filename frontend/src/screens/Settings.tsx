import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Wifi, WifiOff, Lock, Loader2, Radio, Sun, Moon } from 'lucide-react';
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

  const st = wifi.data;
  const nets = scan.data?.networks || [];
  const p = plugins.data?.plugins || [];

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
                      : plg.status === 'disabled'
                        ? 'bg-ink/[0.03] ring-ink/10'
                        : 'bg-red-500/5 ring-red-400/25',
                )}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm font-medium">{plg.name}</div>
                    <div className="text-[11px] text-ink-faint num mt-0.5">v{plg.version}</div>
                  </div>
                  <StatusPill tone={plg.status === 'healthy' ? 'green' : plg.status === 'degraded' ? 'amber' : plg.status === 'disabled' ? 'slate' : 'red'}>
                    {plg.status.toUpperCase()}
                  </StatusPill>
                </div>
                <div className="text-[11px] text-ink-muted mt-2">last seen {plg.last_seen}</div>
              </div>
            ))}
            {p.length === 0 && <div className="col-span-full text-sm text-ink-muted">No plugin data.</div>}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
