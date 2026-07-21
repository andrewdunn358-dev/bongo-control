import { useMemo } from 'react';

interface Props {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
  padding?: number;
  className?: string;
}

/** Small inline SVG sparkline. Drops non-finite points; never fabricates. */
export function Sparkline({
  data,
  width = 220,
  height = 54,
  stroke = '#22d3ee',
  fill = 'rgba(34,211,238,0.25)',
  strokeWidth = 2,
  padding = 2,
  className,
}: Props) {
  const paths = useMemo(() => {
    const values = data.filter((v) => Number.isFinite(v));
    if (values.length < 2) return { line: '', area: '' };
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const range = hi - lo || 1;
    const stepX = (width - padding * 2) / Math.max(values.length - 1, 1);
    const points = values.map((v, i) => {
      const x = padding + i * stepX;
      const y = padding + (1 - (v - lo) / range) * (height - padding * 2);
      return [x, y] as const;
    });
    const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const [firstX] = points[0];
    const [lastX] = points[points.length - 1];
    const area = `${line} L${lastX.toFixed(1)},${height - padding} L${firstX.toFixed(1)},${height - padding} Z`;
    return { line, area };
  }, [data, width, height, padding]);

  const gradId = `spark-${stroke.replace('#', '')}`;

  if (!paths.line) {
    return (
      <svg width={width} height={height} className={className}>
        <text x={width / 2} y={height / 2 + 4} textAnchor="middle" fill="rgba(148,163,184,0.5)" fontSize="10">
          no history yet
        </text>
      </svg>
    );
  }

  return (
    <svg width={width} height={height} className={className}>
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={fill} />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
      </defs>
      <path d={paths.area} fill={`url(#${gradId})`} />
      <path
        d={paths.line}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
