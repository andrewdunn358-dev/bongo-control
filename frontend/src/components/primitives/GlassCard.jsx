import { cn } from '@/lib/utils';

export const GlassCard = ({ children, className, glow, as: Tag = 'div', ...rest }) => {
  const glowClass =
    glow === 'teal' ? 'glow-teal-border' : glow === 'purple' ? 'glow-purple-border' : '';
  return (
    <Tag className={cn('glass relative overflow-hidden', glowClass, className)} {...rest}>
      {children}
    </Tag>
  );
};

export const CardHeader = ({ label, hint, right, className }) => (
  <div className={cn('flex items-start justify-between gap-3 mb-3', className)}>
    <div>
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400/80">{label}</div>
      {hint && <div className="text-xs text-slate-500 mt-0.5">{hint}</div>}
    </div>
    {right}
  </div>
);
