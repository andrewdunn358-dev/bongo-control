import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";

export interface HistoryPoint {
  timestamp: number;
  payload: Record<string, unknown>;
}

export interface LineConfig {
  key: string;
  label: string;
  color: string;
  unit?: string;
}

interface HistoryChartProps {
  data: HistoryPoint[];
  lines: LineConfig[];
}

/**
 * Generic time-series chart for persisted history (Milestone 5). Reused
 * across domains — each page passes its own line configuration (which
 * payload keys to plot, labels, colors) rather than this component
 * knowing anything domain-specific.
 */
export default function HistoryChart({ data, lines }: HistoryChartProps) {
  const chartData = data.map((point) => ({
    timestamp: point.timestamp,
    ...point.payload,
  }));

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis
            dataKey="timestamp"
            tickFormatter={(t: number) => new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            stroke="rgba(255,255,255,0.3)"
            tick={{ fontSize: 11, fill: "#8a93a6" }}
            minTickGap={40}
          />
          <YAxis stroke="rgba(255,255,255,0.3)" tick={{ fontSize: 11, fill: "#8a93a6" }} width={40} />
          <Tooltip
            contentStyle={{ backgroundColor: "#161c26", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }}
            labelFormatter={(t: number) => new Date(t * 1000).toLocaleString()}
          />
          {lines.map((line) => (
            <Line
              key={line.key}
              type="monotone"
              dataKey={line.key}
              name={line.label}
              stroke={line.color}
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
