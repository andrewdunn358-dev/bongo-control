import { useEffect, useState } from "react";
import { Code2 } from "lucide-react";
import Card from "../../components/Cards/Card";
import StatRow from "../../components/Cards/StatRow";
import { api } from "../../services/api";

interface HealthResponse {
  status: string;
  environment: string;
  simulation_mode: boolean;
  uptime_seconds: number;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${Math.round(seconds % 60)}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export default function Developer() {
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    api
      .health()
      .then((data) => setHealth(data as unknown as HealthResponse))
      .catch(() => setHealth(null));
    const interval = setInterval(() => {
      api
        .health()
        .then((data) => setHealth(data as unknown as HealthResponse))
        .catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <Card label="Developer" icon={<Code2 size={14} />}>
      {health ? (
        <div>
          <StatRow label="Backend status" value={health.status} />
          <StatRow label="Environment" value={health.environment} />
          <StatRow label="Simulation mode" value={health.simulation_mode ? "On" : "Off"} />
          <StatRow label="Backend uptime" value={formatUptime(health.uptime_seconds)} />
        </div>
      ) : (
        <span className="text-sm text-text-muted">Could not reach backend</span>
      )}
    </Card>
  );
}
