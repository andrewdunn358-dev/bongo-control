import { cn } from '@/lib/utils';
import { useWeather } from '@/lib/telemetry';
import { selectHeroImage } from '@/lib/heroImage';

/** Fixed layered photo / aurora / grid / noise background, behind every
 * screen in the app. The photograph remains decorative; the theme surface
 * token controls the scrim so light custom themes do not inherit the dark
 * Aurora treatment. */
export function AuroraBackground({ className }: { className?: string }) {
  const weather = useWeather();
  const image = selectHeroImage(weather.payload);

  return (
    <div className={cn('pointer-events-none fixed inset-0 -z-10 overflow-hidden', className)}>
      <img
        src={`/hero/${image}.jpg`}
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
        style={{ objectPosition: 'center 38%' }}
      />

      {/* The scrim is derived from the active surface token rather than
          html.light/html.dark. That matters for packaged themes: a custom
          light theme can be selected while the document still has the dark
          class, so a dark-mode branch would incorrectly leave the whole
          application sitting inside a dark frame. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgb(var(--surface) / .88) 0%, rgb(var(--surface) / .92) 30%, rgb(var(--surface) / .92) 70%, rgb(var(--surface) / .94) 100%)',
        }}
      />

      {/* Ambient corner glows remain functional accents. They resolve from
          the theme tokens, so packaged themes can change their character
          without changing this component. */}
      <div className="absolute -top-40 -left-40 h-[560px] w-[560px] rounded-full bg-brand-orange/15 blur-3xl animate-aurora-pulse" />
      <div
        className="absolute -top-24 right-[-8rem] h-[580px] w-[580px] rounded-full bg-aurora-purple/15 blur-3xl animate-aurora-pulse"
        style={{ animationDelay: '1.4s' }}
      />
      <div
        className="absolute bottom-[-14rem] left-1/3 h-[640px] w-[640px] rounded-full bg-aurora-blue/15 blur-3xl animate-aurora-pulse"
        style={{ animationDelay: '2.8s' }}
      />

      <div className="absolute inset-0 grid-bg opacity-30" />
      <div className="noise" />
    </div>
  );
}
