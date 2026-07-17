import Card, { type CardAccent } from "./Card";
import AnimatedNumber from "./AnimatedNumber";

interface MetricCardProps {
  label: string;
  icon: React.ReactNode;
  /** A pre-formatted string (e.g. "Online", "Charging") OR a raw number for smooth animated transitions. */
  value: string | number;
  /** Decimal places when `value` is numeric. */
  decimals?: number;
  /** Appended after the animated number, e.g. "%", "W", "°C". Ignored for string values. */
  unit?: string;
  /** Prepended before the animated number, e.g. "+" for signed values. Ignored for string values. */
  prefix?: string;
  subtext?: string;
  accent?: CardAccent;
  index?: number;
  /** Larger text for the Home page hero row vs. compact use elsewhere. */
  size?: "default" | "large";
}

/**
 * Compact stat tile — icon, big value, small subtext. Used for the Home
 * page's Quick Status row and reusable anywhere a single-number readout
 * is needed. Numeric values animate smoothly between updates rather
 * than jump-cutting (design feedback: telemetry should feel "alive").
 */
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
  const sizeClass = size === "large" ? "text-3xl md:text-4xl" : "text-2xl md:text-3xl";

  return (
    <Card label={label} icon={icon} accent={accent} index={index}>
      <div className={`font-mono ${sizeClass} font-semibold tabular-nums text-text-primary`}>
        {typeof value === "number" ? <AnimatedNumber value={value} decimals={decimals} prefix={prefix} suffix={unit} /> : value}
      </div>
      {subtext && <div className="mt-1.5 text-sm text-text-secondary">{subtext}</div>}
    </Card>
  );
}
