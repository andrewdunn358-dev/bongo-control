import { cn } from '@/lib/utils';

/** Fixed layered aurora / grid / noise background. Theme-aware via CSS. */
export function AuroraBackground({ className }: { className?: string }) {
  return (
    <div className={cn('pointer-events-none fixed inset-0 -z-10 overflow-hidden', className)}>
      <div className="absolute inset-0" style={{ background: 'var(--aurora-base)' }} />

      {/* Ambient corner glows */}
      <div className="absolute -top-40 -left-40 h-[520px] w-[520px] rounded-full bg-aurora-teal/20 blur-3xl animate-aurora-pulse" />
      <div
        className="absolute -top-24 right-[-8rem] h-[540px] w-[540px] rounded-full bg-aurora-purple/20 blur-3xl animate-aurora-pulse"
        style={{ animationDelay: '1.4s' }}
      />
      <div
        className="absolute bottom-[-14rem] left-1/3 h-[600px] w-[600px] rounded-full bg-aurora-blue/15 blur-3xl animate-aurora-pulse"
        style={{ animationDelay: '2.8s' }}
      />

      {/* Flowing aurora bands — the northern-lights ribbons from the design */}
      <div
        className="aurora-ribbon"
        style={{
          top: '2%',
          background:
            'linear-gradient(90deg, transparent, rgba(52,211,153,0.55) 40%, rgba(34,211,238,0.5) 64%, transparent 92%)',
          animation: 'auroraDrift1 18s ease-in-out infinite alternate',
        }}
      />
      <div
        className="aurora-ribbon"
        style={{
          top: '12%',
          height: '34vh',
          background:
            'linear-gradient(90deg, transparent, rgba(168,85,247,0.42) 30%, rgba(56,189,248,0.4) 66%, transparent)',
          animation: 'auroraDrift2 22s ease-in-out infinite alternate',
        }}
      />
      <div
        className="aurora-ribbon"
        style={{
          top: '-4%',
          height: '30vh',
          background: 'linear-gradient(90deg, transparent, rgba(52,211,153,0.4) 45%, transparent 80%)',
          animation: 'auroraDrift3 26s ease-in-out infinite alternate',
        }}
      />

      <div className="absolute inset-0 grid-bg opacity-70" />
      <div className="noise" />
    </div>
  );
}
