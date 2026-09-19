import type { ComponentType } from 'react';
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
  props,
}: {
  table: Record<string, GraphicEntry<P>>;
  choice: GraphicChoice;
  /** Suffix for the packaged image's class, vw-theme-art-<artClass>. */
  artClass: string;
  /** Alt text for a packaged image. Empty means decorative. */
  alt?: string;
  props: P;
}) {
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
