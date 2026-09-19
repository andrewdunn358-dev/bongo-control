import { useThemeAssets } from '@/lib/useThemeAssets';
import { useCockpitTheme } from '@/lib/useCockpitTheme';
import { publicUrl } from '@/lib/publicUrl';
import type { WidgetProps } from './types';

/** HERO.
 *
 *  Identity, not telemetry: a themed image with the van's name over it.
 *  The image comes from the theme's `hero` asset role and falls back to
 *  a bundled picture, so a theme with no imagery still renders.
 *
 *  TRUTH: nothing here is a reading, so nothing here can be wrong. It
 *  deliberately shows no live camera - that duplicated the Camera
 *  widget and the Camera page while taking the largest area on screen.
 *
 *  STATES: compact renders nothing. On a short viewport the identity
 *  panel is the first thing that should go, and a widget deciding it has
 *  nothing useful to draw at a given state is the widget's own call. */
export function HeroWidget({ state = 'full' }: WidgetProps) {
  const { asset } = useThemeAssets();
  const { heroContent } = useCockpitTheme();
  if (state !== 'full') return null;
  const eyebrow = heroContent?.eyebrow ?? 'MAZDA BONGO · VANOS';
  const title = heroContent?.title ?? 'Adventure\\nlooks good\\non you.';
  const subtitle = heroContent?.subtitle ?? 'Explore · Relax · Disconnect · Repeat';
  const quote = heroContent?.quote ?? '“Not all those who wander are lost.”';
  const quoteAuthor = heroContent?.quoteAuthor ?? 'J.R.R. Tolkien';
  return (
    <section className="vw-hero" data-vw-state={state}>
      <div className="vw-hero-photo">
        <div className="vw-hero-fallback" style={{ backgroundImage: `url(${asset('hero', publicUrl('/hero/snow_night.jpg'))})` }} />
        <div className="vw-hero-overlay" />
        <div className="vw-hero-copy">
          <span className="vw-hero-eyebrow">MAZDA BONGO · VANOS</span>
          <h2>Adventure<br />looks good<br />on you.</h2>
          <div className="vw-hero-rule" />
          <p>{subtitle}</p>
        </div>
        <div className="vw-quote">
          “Not all those who wander<br />are lost.”<small>J.R.R. Tolkien</small>
        </div>
      </div>
    </section>
  );
}
