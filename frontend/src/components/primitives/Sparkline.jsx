import { useMemo } from 'react';

/**
 * Sparkline — lightweight inline SVG sparkline with a soft glow area.
 */
export const Sparkline = ({
  data = [],
  width = 200,
  height = 56,
  stroke = '#22d3ee',
  fill = 'rgba(34,211,238,0.18)',
  strokeWidth = 2,
  min,
  max,
  padding = 2,
  className,
  ...rest
}) => {
  const path = useMemo(() => {
    if (!data.length) return { line: '', area: '' };
    const values = data.map((d) => (typeof d === 'number' ? d : d.value));
    const lo = min ?? Math.min(...values);
    const hi = max ?? Math.max(...values);
    const range = hi - lo || 1;
    const stepX = (width - padding * 2) / Math.max(values.length - 1, 1);
    const points = values.map((v, i) => {
      const x = padding + i * stepX;
      const y = padding + (1 - (v - lo) / range) * (height - padding * 2);
      return [x, y];
    });
    const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const area = `${line} L${points[points.length - 1][0].toFixed(1)},${height - padding} L${points[0][0].toFixed(1)},${height - padding} Z`;
    return { line, area };
  }, [data, width, height, min, max, padding]);

  return (
    <svg width={width} height={height} className={className} {...rest}>
      <defs>
        <linearGradient id={`spark-${stroke.replace('#', '')}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={fill} />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
      </defs>
      {path.area && <path d={path.area} fill={`url(#spark-${stroke.replace('#', '')})`} />}
      {path.line && (
        <path
          d={path.line}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      )}
    </svg>
  );
};
