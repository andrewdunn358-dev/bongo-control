import { Wifi, WifiOff, SignalHigh, Radio } from "lucide-react";
import { useTelemetry } from "../context/TelemetryContext";
import MetricCard from "../components/Cards/MetricCard";
import Card from "../components/Cards/Card";

function formatConnectionType(type: string): string {
  // "4g_hotspot" -> "4G Hotspot"
  return type
    .split("_")
    .map((word) => (word.length <= 2 ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

export default function Connectivity() {
  const { state } = useTelemetry();
  const conn = state.connectivity?.payload;

  if (!conn) {
    return (
      <Card label="Connectivity" icon={<WifiOff size={14} />}>
        <p className="text-sm text-text-muted">No LTE modem configured — connection status will appear here once one is set up.</p>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <MetricCard
        index={0}
        label="Status"
        icon={conn.online ? <Wifi size={14} /> : <WifiOff size={14} />}
        accent={conn.online ? "battery" : "alert"}
        value={conn.online ? "Online" : "Offline"}
      />
      <MetricCard index={1} label="Signal Strength" icon={<SignalHigh size={14} />} value={conn.signal_strength_pct} unit="%" />
      <MetricCard index={2} label="Connection Type" icon={<Radio size={14} />} value={formatConnectionType(conn.connection_type)} />
    </div>
  );
}
