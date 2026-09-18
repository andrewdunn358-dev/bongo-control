/** Pieces used by more than one widget. Lifted verbatim from
 *  AdventureCockpit so the extraction cannot change what renders. */

export function Spark({ data, kind }: { data: number[]; kind: 'battery' | 'solar' }) {
  if (data.length < 2) return null;
  const lo = Math.min(...data),
    hi = Math.max(...data),
    span = Math.max(kind === 'battery' ? 0.4 : 25, hi - lo);
  const points = data
    .map((v, i) => `${(i / (data.length - 1)) * 300},${34 - Math.max(2, ((v - lo) / span) * 30)}`)
    .join(' ');
  return (
    <svg className="vm-spark" viewBox="0 0 300 38" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} />
    </svg>
  );
}

export function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="vm-data-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
