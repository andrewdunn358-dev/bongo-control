import { cn } from '@/lib/utils';
import type { HTMLAttributes, ReactNode } from 'react';

/**
 * Card levels. See the .glass-hero / .glass-quiet block in index.css for
 * the reasoning; the rule that makes them mean anything is ONE hero per
 * screen. If a screen has two heroes it has none.
 *
 * Padding comes WITH the level rather than being chosen per call site.
 * Before this, p-5 and p-6 were mixed across screens with no rule (and
 * p-1 through p-8 in use overall), so spacing carried no information.
 * A `className` with its own p-* still wins, for the genuine exceptions
 * like a card whose child is a full-bleed map or camera frame.
 */
type CardLevel = 'hero' | 'standard' | 'quiet';

const LEVEL_SURFACE: Record<CardLevel, string> = {
  hero: 'glass glass-hero',
  standard: 'glass',
  quiet: 'glass glass-quiet',
};

const LEVEL_PADDING: Record<CardLevel, string> = {
  hero: 'p-6',
  standard: 'p-5',
  quiet: 'p-4',
};

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  glow?: 'teal' | 'purple' | 'orange';
  level?: CardLevel;
  children?: ReactNode;
}

export function GlassCard({ children, className, glow, level = 'standard', ...rest }: GlassCardProps) {
  const glowClass = glow === 'teal' ? 'glow-teal' : glow === 'purple' ? 'glow-purple' : glow === 'orange' ? 'glow-orange' : '';
  return (
    <div
      className={cn(LEVEL_SURFACE[level], 'relative overflow-hidden', LEVEL_PADDING[level], glowClass, className)}
      {...rest}
    >
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
