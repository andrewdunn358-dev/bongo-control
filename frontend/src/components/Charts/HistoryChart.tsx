import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { useTheme } from "../../context/ThemeContext";

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
  // recharts styles its axes/grid/tooltip via inline props, not CSS
  // classes, so it can't pick up the theme automatically the way the
  // rest of the app does - white gridlines and axis labels were
  // invisible on light mode's white card. These have to be resolved in
  // JS from the active theme instead.
  const { resolvedMode } = useTheme();
  const isLight = resolvedMode === "light";
  const gridStroke = isLight ? "rgba(20,24,31,0.10)" : "rgba(255,255,255,0.06)";
  const axisStroke = isLight ? "rgba(20,24,31,0.30)" : "rgba(255,255,255,0.3)";
  const tickFill = isLight ? "#5b6472" : "#8a93a6";
  const tooltipBg = isLight ? "#ffffff" : "#161c26";
  const tooltipBorder = isLight ? "1px solid rgba(20,24,31,0.12)" : "1px solid rgba(255,255,255,0.1)";
  const tooltipText = isLight ? "#14181f" : "#edeff3";

  const chartData = data.map((point) => ({
    timestamp: point.timestamp,
    ...point.payload,
  }));

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={gridStroke} vertical={false} />
          <XAxis
            dataKey="timestamp"
            tickFormatter={(t: number) => new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            stroke={axisStroke}
            tick={{ fontSize: 11, fill: tickFill }}
            minTickGap={40}
          />
          <YAxis stroke={axisStroke} tick={{ fontSize: 11, fill: tickFill }} width={40} />
          <Tooltip
            contentStyle={{ backgroundColor: tooltipBg, border: tooltipBorder, borderRadius: 8, fontSize: 12, color: tooltipText }}
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
