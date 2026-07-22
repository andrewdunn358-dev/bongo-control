import { cn } from '@/lib/utils';

/** Fixed layered aurora / grid / noise background. Theme-aware via CSS. */
export function AuroraBackground({ className }: { className?: string }) {
  return (
    <div className={cn('pointer-events-none fixed inset-0 -z-10 overflow-hidden', className)}>
      <div className="absolute inset-0" style={{ background: 'var(--aurora-base)' }} />

      {/* Ambient corner glows */}
      <div className="absolute -top-40 -left-40 h-[560px] w-[560px] rounded-full bg-aurora-teal/30 blur-3xl animate-aurora-pulse" />
      <div
        className="absolute -top-24 right-[-8rem] h-[580px] w-[580px] rounded-full bg-aurora-purple/30 blur-3xl animate-aurora-pulse"
        style={{ animationDelay: '1.4s' }}
      />
      <div
        className="absolute bottom-[-14rem] left-1/3 h-[640px] w-[640px] rounded-full bg-aurora-blue/20 blur-3xl animate-aurora-pulse"
        style={{ animationDelay: '2.8s' }}
      />

      {/* Flowing aurora bands — the northern-lights ribbons from the design.
          Brighter and spread down the page so it doesn't read as flat navy. */}
      <div
        className="aurora-ribbon"
        style={{
          top: '-2%',
          background:
            'linear-gradient(90deg, transparent, rgba(52,211,153,0.8) 38%, rgba(34,211,238,0.72) 64%, transparent 94%)',
          animation: 'auroraDrift1 18s ease-in-out infinite alternate',
        }}
      />
      <div
        className="aurora-ribbon"
        style={{
          top: '14%',
          background:
            'linear-gradient(90deg, transparent, rgba(168,85,247,0.62) 28%, rgba(56,189,248,0.6) 66%, transparent)',
          animation: 'auroraDrift2 22s ease-in-out infinite alternate',
        }}
      />
      <div
        className="aurora-ribbon"
        style={{
          top: '38%',
          height: '40vh',
          background:
            'linear-gradient(90deg, transparent, rgba(34,211,238,0.5) 20%, rgba(52,211,153,0.5) 60%, transparent 90%)',
          animation: 'auroraDrift3 26s ease-in-out infinite alternate',
        }}
      />
      <div
        className="aurora-ribbon"
        style={{
          top: '64%',
          height: '42vh',
          background:
            'linear-gradient(90deg, transparent, rgba(168,85,247,0.42) 30%, rgba(34,211,238,0.4) 70%, transparent)',
          animation: 'auroraDrift1 30s ease-in-out infinite alternate',
        }}
      />

      <div className="absolute inset-0 grid-bg opacity-50" />
      <div className="noise" />
    </div>
  );
}
