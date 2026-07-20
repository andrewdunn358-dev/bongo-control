import { useEffect, useState } from "react";
import { History as HistoryIcon } from "lucide-react";
import Card from "../components/Cards/Card";
import HistoryChart, { type HistoryPoint, type LineConfig } from "../components/Charts/HistoryChart";
import { api } from "../services/api";

type DomainKey = "battery" | "solar" | "energy" | "environment" | "connectivity";

interface DomainOption {
  key: DomainKey;
  label: string;
  lines: LineConfig[];
}

// Which payload fields to plot per domain — new domains/fields just mean
// adding an entry here, the chart component itself is fully generic.
const DOMAIN_OPTIONS: DomainOption[] = [
  {
    key: "battery",
    label: "Battery",
    lines: [
      { key: "soc_pct", label: "State of Charge (%)", color: "#46d2c4" },
      { key: "voltage", label: "Voltage (V)", color: "#f0a84e" },
    ],
  },
  {
    key: "solar",
    label: "Solar",
    lines: [
      { key: "watts", label: "Output (W)", color: "#f0a84e" },
      { key: "peak_today_watts", label: "Peak Today (W)", color: "#8a93a6" },
    ],
  },
  {
    key: "energy",
    label: "Energy",
    lines: [
      { key: "solar_watts", label: "Solar In (W)", color: "#f0a84e" },
      { key: "load_watts", label: "Loads Out (W)", color: "#46d2c4" },
      { key: "net_watts", label: "Net (W)", color: "#edeff3" },
    ],
  },
  {
    key: "environment",
    label: "Environment",
    lines: [
      { key: "internal_temp_c", label: "Internal (°C)", color: "#f0a84e" },
      { key: "external_temp_c", label: "External (°C)", color: "#46d2c4" },
    ],
  },
  {
    key: "connectivity",
    label: "Connectivity",
    lines: [{ key: "signal_strength_pct", label: "Signal (%)", color: "#46d2c4" }],
  },
];

const TIME_RANGES = [
  { label: "24h", hours: 24 },
  { label: "7d", hours: 24 * 7 },
  { label: "30d", hours: 24 * 30 },
];

export default function History() {
  const [domain, setDomain] = useState<DomainKey>("battery");
  const [hours, setHours] = useState(24);
  const [data, setData] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .history(domain, hours)
      .then((rows) => setData(rows as HistoryPoint[]))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [domain, hours]);

  const activeOption = DOMAIN_OPTIONS.find((o) => o.key === domain)!;

  return (
    <Card label="History" icon={<HistoryIcon size={14} />}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg bg-ink/5 p-1">
          {DOMAIN_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setDomain(opt.key)}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                domain === opt.key ? "bg-ink/10 text-text-primary" : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded-lg bg-ink/5 p-1">
          {TIME_RANGES.map((r) => (
            <button
              key={r.label}
              onClick={() => setHours(r.hours)}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                hours === r.hours ? "bg-ink/10 text-text-primary" : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex h-72 items-center justify-center text-sm text-text-muted">Loading...</div>
      ) : data.length === 0 ? (
        <div className="flex h-72 items-center justify-center text-center text-sm text-text-muted">
          No history yet for this range — readings are sampled every 60s, so it fills in gradually as the app runs.
        </div>
      ) : (
        <HistoryChart data={data} lines={activeOption.lines} />
      )}
    </Card>
  );
}
