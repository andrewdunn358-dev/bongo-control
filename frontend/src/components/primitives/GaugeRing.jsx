import { motion } from 'framer-motion';
import { clamp } from '@/lib/format';

/**
 * GaugeRing — circular SoC gauge, aurora-tinted, animates value smoothly.
 * value: 0..100
 */
export const GaugeRing = ({
  value = 0,
  size = 240,
  stroke = 14,
  label = '',
  unit = '%',
  sublabel = '',
  tone = 'teal',
}) => {
  const v = clamp(Number(value) || 0, 0, 100);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * (v / 100);

  const gradientId = `gauge-grad-${tone}`;
  const stops =
    tone === 'purple'
      ? [
          ['0%', '#c084fc'],
          ['60%', '#a855f7'],
          ['100%', '#38bdf8'],
        ]
      : tone === 'amber'
      ? [
          ['0%', '#fde68a'],
          ['60%', '#f59e0b'],
          ['100%', '#f97316'],
        ]
      : [
          ['0%', '#67e8f9'],
          ['55%', '#22d3ee'],
          ['100%', '#a855f7'],
        ];

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="rotate-[-90deg]">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            {stops.map(([offset, color]) => (
              <stop key={offset} offset={offset} stopColor={color} />
            ))}
          </linearGradient>
          <filter id={`glow-${tone}`}>
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(148,163,184,0.15)"
          strokeWidth={stroke}
          fill="none"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={`url(#${gradientId})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference - dash }}
          transition={{ type: 'spring', stiffness: 60, damping: 18 }}
          filter={`url(#glow-${tone})`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <div className="text-[10px] uppercase tracking-[0.24em] text-slate-400">{label}</div>
        <div className="num mt-1 text-5xl font-semibold text-white">
          {Math.round(v)}
          <span className="ml-0.5 text-2xl text-slate-400 align-top">{unit}</span>
        </div>
        {sublabel && <div className="mt-1 text-xs text-slate-400 num">{sublabel}</div>}
      </div>
    </div>
  );
};
