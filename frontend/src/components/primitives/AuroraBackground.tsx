import { cn } from '@/lib/utils';
import { useWeather } from '@/lib/telemetry';
import { selectHeroImage } from '@/lib/heroImage';

/** Fixed layered photo / aurora / grid / noise background, behind every
 *  screen in the app, not just Home. A plain fixed <img>, not CSS
 *  background-attachment: fixed - that property is a known, real
 *  mobile Safari performance problem (forces a repaint on every scroll
 *  frame); a position:fixed element paints once and stays there for
 *  free, same visual result without the cost. Theme-aware via CSS.
 *
 *  Which photo shows is a real reflection of current weather - not a
 *  random rotation. Five hero images (design credit: Emergent),
 *  selected by the actual WMO weather code + whether it's currently
 *  day or night, using the same code bands already established in
 *  Weather.tsx. See lib/heroImage.ts for the selection logic itself,
 *  tested independently of this component. */
export function AuroraBackground({ className }: { className?: string }) {
  const weather = useWeather();
  const image = selectHeroImage(weather.payload);

  return (
    <div className={cn('pointer-events-none fixed inset-0 -z-10 overflow-hidden', className)}>
      <img src={`/hero/${image}.jpg`} alt="" className="absolute inset-0 w-full h-full object-cover" style={{ objectPosition: 'center 38%' }} />
      {/* Scrim. Two of them, because the dark one was previously the ONLY
          one and light mode inherited it - which is what made light mode
          unusable rather than merely imperfect. The cards are translucent
          white (html.light .glass, 0.88 -> 0.72 alpha); over a near-black
          scrim that composites to grey mud with the photo showing
          straight through the card face, and dark body text on top of it.
          Reported with screenshots, 17 Aug.

          The light scrim is deliberately much stronger than the dark one
          (0.88 -> 0.94, versus 0.72 -> 0.88). It has more to do: dark
          text needs a pale, low-variance field behind it, whereas light
          text over a dark scrim tolerates far more of the photo showing
          through. The photo survives as texture rather than scenery, and
          that is the right trade - it is decoration, and legibility is
          not. */}
      <div
        className="absolute inset-0 dark:hidden"
        style={{
          background:
            'linear-gradient(180deg, rgba(248,250,252,.88) 0%, rgba(248,250,252,.92) 30%, rgba(241,245,249,.92) 70%, rgba(241,245,249,.94) 100%)',
        }}
      />
      <div
        className="absolute inset-0 hidden dark:block"
        style={{
          background:
            'linear-gradient(180deg, rgba(6,9,15,.72) 0%, rgba(6,9,15,.55) 30%, rgba(6,9,15,.72) 70%, rgba(6,9,15,.88) 100%)',
        }}
      />
      {/* The multiply blend only makes sense over the dark scrim - on the
          light one it darkens exactly the field the dark text needs to
          stay pale. */}
      <div className="absolute inset-0 hidden dark:block" style={{ background: 'var(--aurora-base)', opacity: 0.5, mixBlendMode: 'multiply' }} />

      {/* Ambient corner glows — a touch dimmer at the top so text sitting
          directly on the background (page titles/subtitles) stays legible. */}
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
