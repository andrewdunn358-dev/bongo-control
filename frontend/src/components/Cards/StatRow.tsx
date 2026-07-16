interface StatRowProps {
  label: string;
  value: string;
  /** Tailwind bg-* class for a small status dot (e.g. "bg-battery", "bg-alert"). Omit for no dot. */
  dotColor?: string;
}

/**
 * A single label/value row, used inside a Card wherever several related
 * facts are listed together (Active Loads, Settings app info, plugin
 * health). Replaces duplicated ad-hoc <ul><li> markup across pages.
 */
export default function StatRow({ label, value, dotColor }: StatRowProps) {
  return (
    <div className="flex items-center justify-between border-b border-white/5 py-2 text-sm last:border-b-0">
      <span className="flex items-center gap-2 capitalize text-text-secondary">
        {dotColor && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotColor}`} />}
        {label}
      </span>
      <span className="font-mono text-text-primary">{value}</span>
    </div>
  );
}
