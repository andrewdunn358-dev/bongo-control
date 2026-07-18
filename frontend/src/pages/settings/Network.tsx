import { useEffect, useState } from "react";
import { Wifi, WifiOff, Lock, RefreshCw, CheckCircle2 } from "lucide-react";
import Card from "../../components/Cards/Card";
import { api } from "../../services/api";

interface Network {
  ssid: string;
  signal: number | null;
  secured: boolean;
  active: boolean;
}

interface Status {
  connected: boolean;
  ssid: string | null;
  signal: number | null;
  known_networks: string[];
}

function signalBars(signal: number | null): string {
  if (signal === null) return "·";
  if (signal >= 75) return "▂▄▆█";
  if (signal >= 50) return "▂▄▆";
  if (signal >= 25) return "▂▄";
  return "▂";
}

export default function Network() {
  const [status, setStatus] = useState<Status | null>(null);
  const [networks, setNetworks] = useState<Network[]>([]);
  const [scanning, setScanning] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  const [selected, setSelected] = useState<Network | null>(null);
  const [password, setPassword] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const loadStatus = () => {
    api.wifi
      .status()
      .then((s) => {
        setStatus(s);
        setUnavailable(null);
      })
      .catch((e) => setUnavailable(e instanceof Error ? e.message : "WiFi control unavailable"));
  };

  useEffect(loadStatus, []);

  const scan = async () => {
    setScanning(true);
    setConnectError(null);
    try {
      setNetworks(await api.wifi.scan());
      setUnavailable(null);
    } catch (e) {
      setUnavailable(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const connect = async () => {
    if (!selected) return;
    setConnecting(true);
    setConnectError(null);
    try {
      await api.wifi.connect(selected.ssid, password || undefined);
      setSelected(null);
      setPassword("");
      loadStatus();
      scan();
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : "Couldn't connect");
    } finally {
      setConnecting(false);
    }
  };

  if (unavailable) {
    return (
      <Card label="Network" icon={<WifiOff size={14} />} accent="alert">
        <p className="text-sm text-alert">{unavailable}</p>
        <p className="mt-2 text-sm text-text-muted">
          WiFi control needs NetworkManager on the host. If this system uses something else (older Raspberry Pi OS used
          dhcpcd), this page won't work.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card label="Current Connection" icon={<Wifi size={14} />} accent={status?.connected ? "battery" : "neutral"}>
        {status ? (
          status.connected ? (
            <div className="flex items-center gap-2 text-sm text-text-primary">
              <CheckCircle2 size={16} className="text-battery" />
              <span className="font-mono">{status.ssid}</span>
              <span className="text-text-muted">· {status.signal}%</span>
            </div>
          ) : (
            <span className="text-sm text-text-muted">Not connected to WiFi</span>
          )
        ) : (
          <span className="text-sm text-text-muted">Loading…</span>
        )}
      </Card>

      <Card label="Available Networks" icon={<Wifi size={14} />}>
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">
            Switching networks briefly drops the connection — if you're viewing this remotely or over WiFi, the page may
            stop responding for a few seconds while it reconnects.
          </p>

          <button
            onClick={scan}
            disabled={scanning}
            className="flex items-center gap-1.5 rounded-lg bg-white/10 px-4 py-2 text-sm text-text-primary transition-all duration-150 hover:bg-white/15 active:scale-95 disabled:opacity-50"
          >
            <RefreshCw size={14} className={scanning ? "animate-spin" : ""} />
            {scanning ? "Scanning…" : "Scan for Networks"}
          </button>

          {networks.length > 0 && (
            <div className="divide-y divide-white/5">
              {networks.map((n) => {
                const known = status?.known_networks.includes(n.ssid);
                return (
                  <button
                    key={n.ssid}
                    onClick={() => {
                      setSelected(n);
                      setPassword("");
                      setConnectError(null);
                    }}
                    className="flex w-full items-center justify-between gap-3 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="font-mono text-sm text-text-primary truncate">{n.ssid}</span>
                      {n.secured && <Lock size={12} className="shrink-0 text-text-muted" />}
                      {n.active && <span className="shrink-0 text-xs text-battery">connected</span>}
                      {!n.active && known && <span className="shrink-0 text-xs text-text-muted">saved</span>}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-text-muted">
                      {signalBars(n.signal)} {n.signal ?? "–"}%
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      {selected && (
        <Card label={`Connect to ${selected.ssid}`} icon={<Wifi size={14} />} accent="solar">
          <div className="space-y-3">
            {selected.secured && !status?.known_networks.includes(selected.ssid) && (
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Network password"
                autoFocus
                className="w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-muted focus:border-solar focus:outline-none"
              />
            )}
            {status?.known_networks.includes(selected.ssid) && (
              <p className="text-sm text-text-secondary">Saved network — no password needed.</p>
            )}
            {connectError && <p className="text-sm text-alert">{connectError}</p>}
            <div className="flex gap-2">
              <button
                onClick={connect}
                disabled={connecting}
                className="rounded-lg bg-solar px-4 py-2 text-sm font-semibold text-black transition-all duration-150 hover:opacity-90 active:scale-95 disabled:opacity-50"
              >
                {connecting ? "Connecting…" : "Connect"}
              </button>
              <button
                onClick={() => setSelected(null)}
                className="rounded-lg bg-white/10 px-4 py-2 text-sm text-text-primary transition-all duration-150 hover:bg-white/15 active:scale-95"
              >
                Cancel
              </button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
