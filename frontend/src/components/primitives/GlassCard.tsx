import { cn } from '@/lib/utils';
import type { HTMLAttributes, ReactNode } from 'react';

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  glow?: 'teal' | 'purple';
  children?: ReactNode;
}

export function GlassCard({ children, className, glow, ...rest }: GlassCardProps) {
  const glowClass = glow === 'teal' ? 'glow-teal' : glow === 'purple' ? 'glow-purple' : '';
  return (
    <div className={cn('glass relative overflow-hidden', glowClass, className)} {...rest}>
      {children}
    </div>
  );
}

interface CardHeaderProps {
  label: string;
  hint?: ReactNode;
  right?: ReactNode;
  className?: string;
}

export function CardHeader({ label, hint, right, className }: CardHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-3 mb-3', className)}>
      <div>
        <div className="text-[11px] uppercase tracking-[0.18em] text-ink-muted">{label}</div>
        {hint && <div className="text-xs text-ink-faint mt-0.5">{hint}</div>}
      </div>
      {right}
    </div>
  );
}
