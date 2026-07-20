import { useCallback, useEffect, useState } from "react";
import { ToggleLeft, Power, AlertTriangle, Info } from "lucide-react";
import Card from "../components/Cards/Card";
import { api } from "../services/api";

interface RelayChannel {
  id: number;
  gpio: number;
  name: string;
  commanded_on: boolean;
}

export default function Relays() {
  const [channels, setChannels] = useState<RelayChannel[] | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.relays
      .list()
      .then((data) => {
        setChannels(data.channels);
        setAvailable(data.available);
        setReason(data.reason);
      })
      .catch(() => {
        setAvailable(false);
        setReason("Couldn't reach the relay service.");
      });
  }, []);

  useEffect(load, [load]);

  const toggle = async (channel: RelayChannel) => {
    setBusy(channel.id);
    setError(null);
    try {
      const result = await api.relays.set(channel.id, !channel.commanded_on);
      setChannels(result.channels as RelayChannel[]);
    } catch {
      setError(`Couldn't switch ${channel.name}.`);
    } finally {
      setBusy(null);
    }
  };

  const allOff = async () => {
    setBusy(-1);
    setError(null);
    try {
      const result = await api.relays.allOff();
      setChannels(result.channels as RelayChannel[]);
    } catch {
      setError("Couldn't switch everything off.");
    } finally {
      setBusy(null);
    }
  };

  if (available === false) {
    return (
      <Card label="Switches" icon={<ToggleLeft size={16} />} accent="alert">
        <div className="flex items-start gap-3">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-alert" />
          <div>
            <p className="text-sm text-text-primary">Relay control isn't available.</p>
            <p className="mt-1 text-sm text-text-secondary">{reason ?? "No GPIO access on this system."}</p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* This caveat is the whole reason this page reads the way it
          does. The relays sit in parallel with the physical switch
          panel, so the app knows what it last commanded but genuinely
          cannot know whether a circuit is live - someone may have
          flipped a switch, and there's no sense line back. Saying
          "commanded" everywhere rather than "on" is deliberate. */}
      <Card label="How this works" icon={<Info size={16} />} accent="neutral">
        <p className="text-sm text-text-secondary">
          These switch the same circuits as the physical panel, wired in parallel — so either can turn a circuit on.
          The app only knows what <em>it</em> last commanded, not whether a circuit is actually live: if you've flipped
          a physical switch, that won't show here, and the app can't turn it off.
        </p>
      </Card>

      {error && (
        <Card label="Error" icon={<AlertTriangle size={16} />} accent="alert">
          <p className="text-sm text-alert">{error}</p>
        </Card>
      )}

      <Card label="Switches" icon={<ToggleLeft size={16} />} accent="battery">
        {channels === null ? (
          <p className="text-sm text-text-muted">Loading…</p>
        ) : (
          <div className="space-y-2.5">
            {channels.map((channel) => (
              <button
                key={channel.id}
                onClick={() => toggle(channel)}
                disabled={busy !== null}
                className={`flex w-full items-center justify-between gap-4 rounded-2xl border p-4 text-left transition-all duration-150 active:scale-[0.99] disabled:opacity-50 ${
                  channel.commanded_on
                    ? "border-battery/30 bg-battery/10"
                    : "border-ink/[0.08] bg-ink/[0.02] hover:bg-ink/[0.05]"
                }`}
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-text-primary">{channel.name}</div>
                  <div className="mt-0.5 font-mono text-xs text-text-muted">GPIO {channel.gpio}</div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className={`text-xs font-semibold uppercase tracking-wide ${channel.commanded_on ? "text-battery" : "text-text-muted"}`}>
                    {busy === channel.id ? "…" : channel.commanded_on ? "Commanded on" : "Off"}
                  </span>
                  <div
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                      channel.commanded_on ? "bg-battery" : "bg-ink/[0.15]"
                    }`}
                  >
                    <div
                      className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${
                        channel.commanded_on ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        <button
          onClick={allOff}
          disabled={busy !== null || channels === null}
          className="mt-4 flex items-center gap-2 rounded-xl bg-alert/15 px-4 py-2.5 text-sm font-semibold text-alert transition-all duration-150 hover:bg-alert/20 active:scale-95 disabled:opacity-50"
        >
          <Power size={15} />
          {busy === -1 ? "Switching off…" : "All off"}
        </button>
      </Card>
    </div>
  );
}
