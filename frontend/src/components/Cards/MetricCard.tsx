import Card, { type CardAccent } from "./Card";

interface MetricCardProps {
  label: string;
  icon: React.ReactNode;
  value: string;
  subtext?: string;
  accent?: CardAccent;
  index?: number;
}

/**
 * Compact stat tile — icon, big value, small subtext. Used for the Home
 * page's Quick Status row (Battery/Solar/Environment/Connectivity) and
 * reusable anywhere else a single-number readout is needed.
 */
export default function MetricCard({ label, icon, value, subtext, accent = "neutral", index = 0 }: MetricCardProps) {
  return (
    <Card label={label} icon={icon} accent={accent} index={index}>
      <div className="font-mono text-2xl font-semibold tabular-nums text-text-primary md:text-3xl">{value}</div>
      {subtext && <div className="mt-1 text-sm text-text-secondary">{subtext}</div>}
    </Card>
  );
}
