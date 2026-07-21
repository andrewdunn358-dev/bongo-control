import { cn } from '@/lib/utils';

const TONES = {
  green: 'text-status-green bg-emerald-500/10 ring-1 ring-inset ring-emerald-400/30',
  amber: 'text-status-amber bg-amber-500/10 ring-1 ring-inset ring-amber-400/30',
  red: 'text-status-red bg-red-500/10 ring-1 ring-inset ring-red-400/40',
  teal: 'text-aurora-teal bg-cyan-500/10 ring-1 ring-inset ring-cyan-400/30',
  purple: 'text-aurora-purple bg-purple-500/10 ring-1 ring-inset ring-purple-400/30',
  slate: 'text-slate-300 bg-white/5 ring-1 ring-inset ring-white/10',
};

export const StatusPill = ({ tone = 'slate', dot = true, className, children, ...rest }) => (
  <span className={cn('pill', TONES[tone] || TONES.slate, className)} {...rest}>
    {dot && (
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          tone === 'green' && 'bg-status-green shadow-[0_0_10px_rgba(16,185,129,0.9)]',
          tone === 'amber' && 'bg-status-amber shadow-[0_0_10px_rgba(245,158,11,0.9)]',
          tone === 'red' && 'bg-status-red shadow-[0_0_10px_rgba(239,68,68,0.9)] animate-live-pulse',
          tone === 'teal' && 'bg-aurora-teal shadow-[0_0_10px_rgba(34,211,238,0.9)]',
          tone === 'purple' && 'bg-aurora-purple shadow-[0_0_10px_rgba(168,85,247,0.9)]',
          tone === 'slate' && 'bg-slate-300',
        )}
      />
    )}
    {children}
  </span>
);
