import type { ComponentType } from 'react';
import type { ArtworkChoice } from '@/lib/artwork';
import type { GraphicChoice } from '@/layout/graphicChoice';
import type { GraphicEntry } from './registry';
import { pick } from './registry';

/**
 * Draws whatever layout/graphicChoice.ts decided: the theme's packaged
 * image, or a registered drawing fed the widget's data.
 *
 * This is the only place a packaged image replaces a graphic. The
 * drawings themselves never see one.
 */
export function GraphicSlot<P extends object>({
  table,
  choice,
  artClass,
  alt,
  art,
  props,
}: {
  table: Record<string, GraphicEntry<P>>;
  choice: GraphicChoice;
  /** Suffix for the packaged image's class, vw-theme-art-<artClass>. */
  artClass: string;
  /** Alt text for a packaged image. Empty means decorative. */
  alt?: string;
  /** The theme's state-driven artwork for THIS reading, already
   *  resolved (lib/artwork.ts). It wins over everything else: it is the
   *  most specific thing a theme can say, and it follows the data. Null
   *  when the theme says nothing for this reading. */
  art?: ArtworkChoice;
  props: P;
}) {
  if (art?.kind === 'image') {
    return (
      <img
        className={`vw-theme-art vw-theme-art-${artClass}`}
        src={art.src}
        alt={alt ?? ''}
        aria-hidden={alt ? undefined : true}
      />
    );
  }
  if (art?.kind === 'fill') {
    // The fill is CLIPPED to the reading - the artwork's own liquid
    // line, between the empty and full marks the theme gave.
    const line = art.top + (1 - art.fraction) * (art.bottom - art.top);
    return (
      <span className={`vw-theme-art-stack vw-theme-art-${artClass}`} aria-hidden={alt ? undefined : true}>
        <img className="vw-theme-art" src={art.body} alt={alt ?? ''} />
        <img
          className="vw-theme-art vw-theme-art-liquid"
          src={art.fill}
          alt=""
          aria-hidden
          style={{ clipPath: `inset(${(line * 100).toFixed(2)}% 0 ${((1 - art.bottom) * 100).toFixed(2)}% 0)` }}
        />
      </span>
    );
  }
  if (choice.source === 'theme-asset') {
    return (
      <img
        className={`vw-theme-art vw-theme-art-${artClass}`}
        src={choice.url}
        alt={alt ?? ''}
        aria-hidden={alt ? undefined : true}
      />
    );
  }
  const Drawing: ComponentType<P> = pick(table, choice.variant);
  return <Drawing {...props} />;
}

/** The choice a widget falls back to when rendered without one - which
 *  only happens outside the layout renderer. With no measured slot there
 *  is no way to know an illustrated drawing fits, so it is the standard
 *  one, or whatever variant the caller named. */
export function choiceFromVariant(variant: string | undefined): GraphicChoice {
  return { source: 'built-in', variant: variant ?? 'standard', reason: 'no-variant-requested' };
}
