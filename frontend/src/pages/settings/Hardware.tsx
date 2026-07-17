import { useEffect, useState } from "react";
import { Cpu, ExternalLink, Radar, CheckCircle2, XCircle } from "lucide-react";
import Card from "../../components/Cards/Card";
import { api, type ScanResult } from "../../services/api";

export default function Hardware() {
  const [macAddress, setMacAddress] = useState("");
  const [encryptionKey, setEncryptionKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState<ScanResult[] | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  useEffect(() => {
    api.plugins
      .getConfig("victron_mppt")
      .then((config) => {
        setMacAddress((config.mac_address as string) ?? "");
        setEncryptionKey((config.encryption_key as string) ?? "");
      })
      .finally(() => setLoaded(true));
  }, []);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await api.plugins.setConfig("victron_mppt", {
        mac_address: macAddress.trim() || null,
        encryption_key: encryptionKey.trim() || null,
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const scan = async () => {
    setScanning(true);
    setScanError(null);
    setScanResults(null);
    try {
      const results = await api.plugins.scan("victron_mppt", 8);
      setScanResults(results);
    } catch {
      setScanError("Scan failed — check the plugin is reachable and Bluetooth is available.");
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card label="Victron SmartSolar MPPT" icon={<Cpu size={14} />}>
        {!loaded ? (
          <span className="text-sm text-text-muted">Loading...</span>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              Connects over Bluetooth using Victron's "Instant Readout" broadcast — no pairing needed, just the
              per-device encryption key from the VictronConnect app.{" "}
              <a
                href="https://github.com/andrewdunn358-dev/bongo-control/blob/main/docs/victron_ble_integration.md"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-solar hover:underline"
              >
                Setup guide <ExternalLink size={12} />
              </a>
            </p>

            <div className="space-y-1.5">
              <label className="text-xs uppercase tracking-wide text-text-muted">Encryption key</label>
              <input
                type="text"
                value={encryptionKey}
                onChange={(e) => setEncryptionKey(e.target.value)}
                placeholder="32-character hex key from VictronConnect"
                className="w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-muted focus:border-solar focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs uppercase tracking-wide text-text-muted">MAC address (optional)</label>
              <input
                type="text"
                value={macAddress}
                onChange={(e) => setMacAddress(e.target.value)}
                placeholder="Leave blank to use the first Victron device found"
                className="w-full rounded-lg border border-white/10 bg-surface-raised px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-muted focus:border-solar focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={save}
                disabled={saving}
                className="rounded-lg bg-solar px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              {saved && <span className="text-sm text-battery">Saved — enable the plugin on the Plugins tab to connect.</span>}
            </div>
          </div>
        )}
      </Card>

      <Card label="Scan for Devices" icon={<Radar size={14} />}>
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">
            Looks for any nearby Victron devices broadcasting over Bluetooth, independent of whether the plugin is
            enabled — useful for confirming hardware is actually visible before troubleshooting anything else.
          </p>
          <button
            onClick={scan}
            disabled={scanning}
            className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-white/15 disabled:opacity-50"
          >
            {scanning ? "Scanning (8s)..." : "Scan for Devices"}
          </button>

          {scanError && <p className="text-sm text-alert">{scanError}</p>}

          {scanResults && (
            <div className="space-y-2">
              {scanResults.length === 0 ? (
                <p className="text-sm text-text-muted">
                  No Victron devices seen. Check the MPPT is powered, in range, and that Bluetooth is actually
                  reachable from this container (see the Docker/Bluetooth note in the setup guide).
                </p>
              ) : (
                scanResults.map((r) => (
                  <div key={r.mac_address} className="flex items-center justify-between rounded-lg bg-surface-raised px-3 py-2">
                    <div>
                      <div className="text-sm text-text-primary">{r.name ?? r.mac_address}</div>
                      <div className="font-mono text-xs text-text-muted">
                        {r.mac_address} · {r.rssi} dBm{r.model_name ? ` · ${r.model_name}` : ""}
                      </div>
                    </div>
                    {r.decrypt_success === true && (
                      <span className="flex items-center gap-1 text-xs text-battery">
                        <CheckCircle2 size={14} /> Key works
                      </span>
                    )}
                    {r.decrypt_success === false && (
                      <span className="flex items-center gap-1 text-xs text-alert">
                        <XCircle size={14} /> Key doesn't match
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </Card>

      <Card label="Victron SmartShunt">
        <p className="text-sm text-text-muted">
          Not yet owned — battery state-of-charge and full energy-flow data depend on this. Its plugin will reuse the
          same architecture as the MPPT plugin once it's a future milestone.
        </p>
      </Card>
    </div>
  );
}
