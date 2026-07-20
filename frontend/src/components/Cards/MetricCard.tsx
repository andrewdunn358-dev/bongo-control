import Card, { type CardAccent } from "./Card";
import AnimatedNumber from "./AnimatedNumber";

interface MetricCardProps {
  label: string;
  icon: React.ReactNode;
  value: string | number;
  decimals?: number;
  unit?: string;
  prefix?: string;
  subtext?: string;
  accent?: CardAccent;
  index?: number;
  size?: "default" | "large";
}

export default function MetricCard({
  label,
  icon,
  value,
  decimals = 0,
  unit = "",
  prefix = "",
  subtext,
  accent = "neutral",
  index = 0,
  size = "default",
}: MetricCardProps) {
  const sizeClass = size === "large" ? "text-5xl lg:text-6xl" : "text-3xl lg:text-4xl";

  return (
    <Card label={label} icon={icon} accent={accent} index={index} compact>
      <div className={`font-mono ${sizeClass} font-semibold leading-none tracking-[-0.05em] tabular-nums text-ink`}>
        {typeof value === "number" ? <AnimatedNumber value={value} decimals={decimals} prefix={prefix} suffix={unit} /> : value}
      </div>
      {subtext && <div className="mt-4 min-h-6 text-sm font-medium uppercase tracking-[0.16em] text-ink/45">{subtext}</div>}
    </Card>
  );
}
