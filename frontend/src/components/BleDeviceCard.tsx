import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Radar } from 'lucide-react';
import { GlassCard, CardHeader } from '@/components/primitives/GlassCard';
import { api, ApiError } from '@/lib/api';

/**
 * Config fields for a Bluetooth plugin - MAC address and, where the
 * device needs one, an encryption key.
 *
 * These existed only as curl commands and hand-edits to config.json
 * until now: the backend routes (GET/PUT /plugins/{name}/config, with
 * secret redaction and empty-means-unchanged already handled) have been
 * there all along, with no UI in front of them. Setting up a Victron
 * device meant reading a handover note and typing a curl into a van.
 *
 * The encryption key is write-only, matching the backend: GET returns
 * it blanked, and saving an empty field leaves the stored one alone -
 * so re-saving a MAC does not wipe the key.
 */

type Props = {
  plugin: string;
  title: string;
  hint?: string;
  /** Show an encryption key field. Victron devices need one; not all do. */
  hasKey?: boolean;
  /** Offer a scan button. Only some plugins implement discovery. */
  canScan?: boolean;
  /** What the MAC field is for, in plain terms. */
  macHelp?: string;
};

export function BleDeviceCard({ plugin, title, hint, hasKey, canScan, macHelp }: Props) {
  const qc = useQueryClient();
  const key = ['plugin-config', plugin];

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api.pluginConfig(plugin),
    retry: false,
  });

  const [mac, setMac] = useState('');
  const [encKey, setEncKey] = useState('');
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (data && !seeded) {
      setMac(String((data.mac_address ?? data.mac ?? '') as string));
      setSeeded(true);
    }
  }, [data, seeded]);

  // The backend blanks secrets on GET, so a stored key comes back as an
  // empty string. It reports separately whether one is set.
  const keyIsSet = data?.encryption_key_set === true || Boolean(data?.encryption_key);

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      // Whichever key name this plugin already uses, so we do not
      // create a second one alongside it.
      body[data && 'mac' in data ? 'mac' : 'mac_address'] = mac.trim();
      if (hasKey && encKey.trim()) body.encryption_key = encKey.trim();
      return api.updatePluginConfig(plugin, body);
    },
    onSuccess: () => {
      toast.success('Saved. Disable and re-enable the plugin for it to take effect.');
      setEncKey('');
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ['plugins'] });
    },
    onError: () => toast.error('Could not save'),
  });

  const scan = useMutation({
    mutationFn: () => api.scanPlugin(plugin, 10),
    onSuccess: (found) => {
      if (!found.length) {
        toast.warning('Nothing found. Is the device powered and in range?');
        return;
      }
      // Strongest signal first - the device you are stood next to.
      const best = [...found].sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
      setMac(best[0].address);
      toast.success(`Found ${best.length} device(s). Filled in the strongest.`);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 501) toast.warning('This plugin does not support scanning.');
      else toast.error('Scan failed.');
    },
  });

  if (isLoading) return null;

  return (
    <GlassCard className="col-span-12 md:col-span-6 p-6">
      <CardHeader label={title} hint={hint} />

      <label className="text-[11px] uppercase tracking-widest text-ink-muted">MAC address</label>
      <div className="flex gap-2 mt-1">
        <input
          value={mac}
          onChange={(e) => setMac(e.target.value)}
          placeholder="AA:BB:CC:DD:EE:FF"
          className="flex-1 min-w-0 rounded-xl bg-ink/[0.04] ring-1 ring-inset ring-ink/10 px-3 py-2 text-sm num outline-none focus:ring-aurora-teal/50"
        />
        {canScan && (
          <button
            type="button"
            onClick={() => scan.mutate()}
            disabled={scan.isPending}
            title="Scan for nearby devices and fill in the strongest"
            className="shrink-0 inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm ring-1 ring-inset ring-ink/15 hover:bg-ink/[0.06] disabled:opacity-40"
          >
            {scan.isPending ? <Loader2 size={15} className="spin" /> : <Radar size={15} />}
            Scan
          </button>
        )}
      </div>
      {macHelp && <div className="text-[11px] text-ink-faint mt-1">{macHelp}</div>}

      {hasKey && (
        <div className="mt-4">
          <label className="text-[11px] uppercase tracking-widest text-ink-muted">
            Encryption key {keyIsSet && <span className="text-emerald-400 normal-case tracking-normal">· set</span>}
          </label>
          <input
            value={encKey}
            onChange={(e) => setEncKey(e.target.value)}
            placeholder={keyIsSet ? '•••••••• (leave blank to keep)' : 'from VictronConnect'}
            className="mt-1 w-full rounded-xl bg-ink/[0.04] ring-1 ring-inset ring-ink/10 px-3 py-2 text-sm num outline-none focus:ring-aurora-teal/50"
          />
          <div className="text-[11px] text-ink-faint mt-1">
            VictronConnect → your device → Product info → Instant readout. Never shown again once saved.
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => save.mutate()}
        disabled={save.isPending}
        className="mt-4 rounded-full px-4 py-2 text-sm bg-aurora-teal text-navy-900 font-semibold hover:brightness-110 disabled:opacity-40"
      >
        {save.isPending ? 'Saving…' : 'Save'}
      </button>
    </GlassCard>
  );
}
