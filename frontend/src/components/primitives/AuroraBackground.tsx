import { cn } from '@/lib/utils';
import { useWeather } from '@/lib/telemetry';
import { selectHeroImage } from '@/lib/heroImage';
import { publicUrl } from '@/lib/publicUrl';

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
        src={publicUrl(`/hero/${image}.jpg`)}
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
        style={{ objectPosition: 'center 38%' }}
      />

      {/* The scrim is derived from the active surface token rather than
          html.light/html.dark. That matters for packaged themes: a custom
          light theme can be selected while the document still has the dark
          class, so a dark-mode branch would incorrectly leave the whole
          application sitting inside a dark frame.

          ALPHA STOPS, and why they are not all high: collapsing the two
          old scrims into one initially took the LIGHT scrim's strength
          (.88/.92/.92/.94) and applied it to both. Measured on the Roof
          page, that turned the dark theme's night photograph into a flat
          blue haze - the middle stop alone went .55 -> .92. The old code
          used different alphas per mode deliberately: dark text needs a
          pale, low-variance field, whereas light text over a dark scrim
          tolerates far more of the photo showing through.
          One scrim cannot know which case it is in, so these stops are
          the compromise: strong at the top and bottom where headings and
          the footer sit, lighter through the middle where the photograph
          lives and cards supply their own background anyway. Verified in
          both directions - see the contrast figures in the PR.

          NOTE, kept from the original and still true: this is a fixed
          <img> rather than CSS background-attachment: fixed, because that
          property forces a repaint on every scroll frame on mobile
          Safari. A position:fixed element paints once. Same visual
          result, none of the cost. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgb(var(--surface) / .88) 0%, rgb(var(--surface) / .72) 30%, rgb(var(--surface) / .80) 70%, rgb(var(--surface) / .92) 100%)',
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
