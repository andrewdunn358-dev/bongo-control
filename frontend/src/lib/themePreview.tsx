import { createContext, useContext } from 'react';
import type { CustomTheme } from '@/lib/customThemes';

/**
 * PREVIEWING A THEME THAT IS NOT INSTALLED.
 *
 * The Theme Studio has to show a theme being edited, using the van's own
 * widgets - anything else draws a picture of VanOS rather than VanOS,
 * and what you design is then not what the van shows. That was the
 * whole failure this exists to avoid.
 *
 * So the widgets are the real ones and only their INPUTS are swapped.
 * Inside this provider, the two hooks a theme reaches widgets through -
 * useCockpitTheme (hero copy) and useThemeAssets (imagery) - answer from
 * the draft instead of the installed theme. Colours, fonts, radii and
 * density are not here: those are CSS variables the Studio sets on the
 * preview container itself, so they stay inside it.
 *
 * Outside the provider (which is everywhere except the Studio's preview)
 * the context is undefined and nothing changes.
 */
export interface ThemePreview {
  /** Words over the hero image; same shape a package supplies. */
  heroContent?: CustomTheme['heroContent'];
  /** Which drawing each widget should use, as the draft asks for it. */
  widgetPresentation?: Record<string, { variant?: string }>;
  /** role -> object URL for an image the author has chosen but not yet
   *  installed on the Pi. */
  assetUrls: Record<string, string>;
  heroCamera: boolean;
}

const ThemePreviewContext = createContext<ThemePreview | undefined>(undefined);

export const ThemePreviewProvider = ThemePreviewContext.Provider;

/** The draft being previewed, or undefined in the app proper. */
export function useThemePreview(): ThemePreview | undefined {
  return useContext(ThemePreviewContext);
}
