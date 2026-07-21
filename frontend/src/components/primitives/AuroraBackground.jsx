import { cn } from '@/lib/utils';

/**
 * AuroraBackground — fixed, layered aurora + grid + noise. Used once at app
 * root so every screen sits above the same living backdrop. Respects the
 * current theme via the `.dark` / `.light` class on <html>.
 */
export const AuroraBackground = ({ className }) => (
  <div className={cn('pointer-events-none fixed inset-0 -z-10 overflow-hidden', className)}>
    {/* Base gradient — swaps between dark navy and daylight */}
    <div className="absolute inset-0 aurora-base" />

    {/* Aurora blobs */}
    <div className="absolute -top-40 -left-40 h-[520px] w-[520px] rounded-full bg-aurora-teal/25 blur-3xl animate-aurora-pulse" />
    <div
      className="absolute -top-24 right-[-8rem] h-[540px] w-[540px] rounded-full bg-aurora-purple/25 blur-3xl animate-aurora-pulse"
      style={{ animationDelay: '1.4s' }}
    />
    <div
      className="absolute bottom-[-14rem] left-1/3 h-[600px] w-[600px] rounded-full bg-aurora-blue/20 blur-3xl animate-aurora-pulse"
      style={{ animationDelay: '2.8s' }}
    />

    {/* Grid overlay */}
    <div className="absolute inset-0 grid-bg opacity-70" />

    {/* Grain */}
    <div className="noise" />
  </div>
);
