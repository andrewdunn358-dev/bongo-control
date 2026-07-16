import { useEffect, useState } from "react";
import { History as HistoryIcon } from "lucide-react";
import Card from "../components/Cards/Card";
import Timeline from "../components/Timeline/Timeline";
import { api } from "../services/api";
import type { TelemetryMessage, BatteryPayload } from "../types/telemetry";

// SQLite-backed persistent history + charts (recharts) land in Milestone
// 5. For now this reads the bus's in-memory ring buffer, presented via
// the same Timeline component the Home page's Recent Events uses.
export default function History() {
  const [history, setHistory] = useState<TelemetryMessage<BatteryPayload>[]>([]);

  useEffect(() => {
    api
      .history("battery")
      .then((data) => setHistory(data as TelemetryMessage<BatteryPayload>[]))
      .catch(() => setHistory([]));
  }, []);

  const items = history
    .slice()
    .reverse()
    .map((m, i) => ({
      id: `${m.timestamp}-${i}`,
      timestamp: m.timestamp,
      text:
        m.payload.soc_pct !== null
          ? `Battery ${Math.round(m.payload.soc_pct)}% (${m.payload.charging ? "charging" : "discharging"})`
          : `Battery ${m.payload.voltage}V (${m.payload.charging ? "charging" : "discharging"})`,
    }));

  return (
    <Card label="Battery History" icon={<HistoryIcon size={14} />}>
      <div className="max-h-96 overflow-y-auto pr-1">
        <Timeline
          items={items}
          emptyMessage="No history yet — charts land in a later milestone once SQLite logging is wired up."
        />
      </div>
    </Card>
  );
}
