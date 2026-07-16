import { useEffect, useState } from "react";
import Card from "../components/Cards/Card";
import { api } from "../services/api";
import type { TelemetryMessage, BatteryPayload } from "../types/telemetry";

// Placeholder for Milestone 5 (history graphs + SQLite logging).
// Currently reads the bus's in-memory ring buffer via REST; will be
// backed by persisted SQLite history and a real chart (recharts) once
// that milestone lands.
export default function History() {
  const [history, setHistory] = useState<TelemetryMessage<BatteryPayload>[]>([]);

  useEffect(() => {
    api
      .history("battery")
      .then((data) => setHistory(data as TelemetryMessage<BatteryPayload>[]))
      .catch(() => setHistory([]));
  }, []);

  return (
    <Card label="Battery History (last readings)">
      {history.length === 0 ? (
        <span className="text-white/40">
          No history yet — charts (recharts) land in Milestone 5 once SQLite logging is wired up.
        </span>
      ) : (
        <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
          {history
            .slice()
            .reverse()
            .map((m, i) => (
              <li key={i}>
                {new Date(m.timestamp * 1000).toLocaleTimeString()} — {m.payload.soc_pct}%
              </li>
            ))}
        </ul>
      )}
    </Card>
  );
}
