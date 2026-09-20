/**
 * CUSTOM THEME FILES
 *
 * A THEME IS AN INSTALLED .vanos-theme PACKAGE. Tokens, typography,
 * shape, imagery, a Home composition and per-widget drawing - data, not
 * code, stored on the Pi and shared by every device that connects to it.
 *
 * There used to be a SECOND thing called a theme: a browser-local JSON
 * file of colour tokens, kept in localStorage, which could set colours
 * and nothing else - no cockpit, no composition, no presentation, no
 * imagery. Two objects with one name, listed together, with different
 * capabilities. It has been removed; see LEGACY_THEME_KEY below.
 *
 * What remains here can be applied instantly with no rebuild
 * and no deploy. That is the whole point of the format - a theme
 * written by anyone (including another AI) cannot crash the app,
 * because nothing in the file is ever executed. The worst a bad theme
 * can do is look wrong, and it can be deleted in one click.
 *
 * SECURITY: every value is validated against a strict pattern before
 * it reaches the DOM. Token VALUES are only ever written via
 * element.style.setProperty(), never by injecting a <style> block or
 * any markup, so a crafted file cannot smuggle CSS or script in. Names
 * are checked against an allow-list, so a file cannot set an arbitrary
 * custom property either.
 *
 * File shape:
 *   {
 *     "name": "Highland",
 *     "author": "optional",
 *     "tokens": {
 *       "ink": "244 249 255",
 *       "surface": "7 21 34",
 *       "aurora-base": "linear-gradient(180deg, #020911 0%, #071522 100%)"
 *     }
 *   }
 */

import type { Artwork } from '@/lib/artwork';
import type { LayoutDefinition } from '@/layout/schema';
import { parseLayout } from '@/layout/schema';

export interface CustomTheme {
  id: string;
  name: string;
  author?: string;
  tokens: Record<string, string>;
  /** 0 = legacy plain-JSON colour theme, 1 = .vanos-theme package.
   *  Absent on themes stored before packages existed, which is exactly
   *  why the check below treats undefined as 0 rather than failing. */
  formatVersion?: 0 | 1;
  description?: string;
  /** Package extras. All optional - a v0 theme has none of them. */
  typography?: Partial<Record<'sans' | 'display' | 'mono', string>>;
  shape?: Partial<Record<'sm' | 'md' | 'lg' | 'xl' | '2xl', string>>;
  density?: 'compact' | 'normal' | 'spacious';
  /** Logical name -> asset path inside the package, e.g. hero -> assets/hero.jpg */
  assets?: Record<string, string>;
  previewPath?: string;
  /** Set for themes stored on the Pi; used to build asset URLs. */
  serverId?: string;
  /** false = hero shows the theme's own image, camera stays in its tile. */
  heroCamera?: boolean;
  /** Which image shows at which reading (lib/artwork.ts). */
  artwork?: Artwork;
  /** Optional hero copy supplied by the installed theme. */
  heroContent?: { eyebrow?: string; title?: string; subtitle?: string; quote?: string; quoteAuthor?: string };
  /** Built-in cockpit layout this theme renders in. Validated against
   *  the registry; unknown or absent falls back to the default. */
  cockpit?: string;
  /** The Home COMPOSITION this theme defines - which registered widgets
   *  appear and how they are allocated. Validated by parseLayout, which
   *  accepts allocation intent only, so no CSS can arrive this way.
   *  Absent means the cockpit renders its built-in composition, so every
   *  theme written before this keeps working unchanged. */
  homeLayout?: LayoutDefinition;
  /** Widget ids the theme asked for that this build does not have, kept
   *  so the UI can say so rather than leaving an unexplained gap. */
  unknownWidgets?: string[];
  /** Which drawing each widget should use. Validated against the
   *  graphics registry; anything unknown falls back to 'standard'. */
  widgetPresentation?: Record<string, { variant?: string }>;
}

/** Tokens a theme file is allowed to set.
 *
 *  DELIBERATELY EXCLUDES --status-green/amber/red and --brand-orange.
 *  Those carry meaning - charging, attention, fault, active nav - and a
 *  theme recolouring them to suit an aesthetic makes the van harder to
 *  read at a glance. Same reasoning as the built-in themes. */
export const THEMEABLE_TOKENS = [
  'ink',
  'ink-soft',
  'ink-muted',
  'ink-faint',
  'surface',
  'surface-raised',
  'surface-sunken',
  'line',
  'aurora-teal',
  'aurora-blue',
  'aurora-purple',
  'aurora-pink',
  'aurora-lime',
  'aurora-base',
] as const;

const TOKEN_SET = new Set<string>(THEMEABLE_TOKENS);

/** Font stacks a theme may CHOOSE from. A theme names one of these; it
 *  cannot supply its own family string. That is deliberate: no remote
 *  font loading, so the van's dashboard never depends on someone else's
 *  CDN being reachable, and a theme cannot inject arbitrary CSS through
 *  a font-family value. */
export const FONT_CHOICES: Record<string, string> = {
  grotesk: '"Space Grotesk", ui-sans-serif, system-ui, sans-serif',
  system: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  humanist: 'Inter, "Segoe UI", ui-sans-serif, system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
};

/** Radii are a bounded set of lengths, not free-form CSS. */
const RADIUS = /^(0|[0-9]{1,2}(\.[0-9]{1,2})?(px|rem))$/;
const DENSITIES = new Set(['compact', 'normal', 'spacious']);
const DENSITY_SCALE: Record<string, string> = { compact: '0.8', normal: '1', spacious: '1.25' };

/** "R G B", 0-255 each - the form Tailwind's <alpha-value> syntax needs. */
const RGB_TRIPLET = /^\d{1,3}\s+\d{1,3}\s+\d{1,3}$/;

/** A conservative gradient/colour subset for --aurora-base. Anything
 *  with a url(), expression, or semicolon is rejected outright rather
 *  than sanitised - it is easier to be sure about a small allow-list
 *  than about a blocklist. */
const SAFE_BACKGROUND = /^(linear-gradient|radial-gradient)\([#\w\s,.%()-]+\)$|^#[0-9a-fA-F]{3,8}$/;

export const MAX_THEME_FILE_BYTES = 32 * 1024;

export class ThemeFileError extends Error {}

function validTriplet(v: string): boolean {
  if (!RGB_TRIPLET.test(v)) return false;
  return v.split(/\s+/).every((n) => Number(n) >= 0 && Number(n) <= 255);
}


/**
 * Validates the token half of a theme, shared by BOTH the legacy plain
 * JSON path and the .vanos-theme package path. One validator means the
 * two formats can never drift apart on what a valid colour is.
 */
export function parseThemeDefinition(name: string, obj: Record<string, unknown>): CustomTheme {
  const rawTokens = obj.tokens;
  if (typeof rawTokens !== 'object' || rawTokens === null || Array.isArray(rawTokens)) {
    throw new ThemeFileError('The theme has no "tokens" object.');
  }

  const tokens: Record<string, string> = {};
  const unknown: string[] = [];
  const invalid: string[] = [];

  for (const [key, value] of Object.entries(rawTokens as Record<string, unknown>)) {
    const clean = key.replace(/^--/, '');
    if (!TOKEN_SET.has(clean)) {
      unknown.push(clean);
      continue;
    }
    if (typeof value !== 'string') {
      invalid.push(clean);
      continue;
    }
    const v = value.trim();
    const ok = clean === 'aurora-base' ? SAFE_BACKGROUND.test(v) : validTriplet(v);
    if (!ok) {
      invalid.push(clean);
      continue;
    }
    tokens[clean] = v;
  }

  if (invalid.length) {
    throw new ThemeFileError(
      `These tokens have invalid values: ${invalid.slice(0, 4).join(', ')}. ` +
        'Colours must be "R G B" (e.g. "15 41 66"); aurora-base may be a gradient or hex colour.',
    );
  }
  if (!Object.keys(tokens).length) {
    throw new ThemeFileError(
      unknown.length
        ? `No usable tokens. Unrecognised: ${unknown.slice(0, 4).join(', ')}.`
        : 'The theme file sets no tokens.',
    );
  }

  return {
    // Stable id from the name, so re-uploading an edited file of the
    // same name replaces it rather than accumulating duplicates.
    id: `custom:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
    name,
    author: typeof obj.author === 'string' ? obj.author.slice(0, 60) : undefined,
    tokens,
    formatVersion: 0,
  };
}

/**
 * Builds a CustomTheme from a validated .vanos-theme package.
 *
 * Every field is checked here rather than trusted from the package:
 * parseThemePackage() proves the ZIP is structurally safe, this proves
 * the CONTENT is meaningful. Unknown keys are dropped; invalid values
 * reject the whole import rather than being silently ignored, so a
 * theme never half-applies.
 */
export function themeFromPackage(
  manifest: { name: string; author?: string; description?: string; preview?: string },
  definition: Record<string, unknown>,
  assetPaths: string[],
  /** Registry ids, passed in rather than imported: this module stays
   *  free of the widget components, which import theme code themselves. */
  knownWidgets: readonly string[] = [],
): CustomTheme {
  const base = parseThemeDefinition(manifest.name, definition);

  const typography: CustomTheme['typography'] = {};
  const rawType = definition.typography;
  if (rawType && typeof rawType === 'object' && !Array.isArray(rawType)) {
    for (const [slot, choice] of Object.entries(rawType as Record<string, unknown>)) {
      if (!['sans', 'display', 'mono'].includes(slot)) continue;
      if (typeof choice !== 'string' || !FONT_CHOICES[choice]) {
        throw new ThemeFileError(
          `Unknown font "${String(choice).slice(0, 20)}". Choose one of: ${Object.keys(FONT_CHOICES).join(', ')}.`,
        );
      }
      typography[slot as 'sans' | 'display' | 'mono'] = choice;
    }
  }

  const shape: CustomTheme['shape'] = {};
  const rawShape = definition.shape;
  if (rawShape && typeof rawShape === 'object' && !Array.isArray(rawShape)) {
    for (const [k, v] of Object.entries(rawShape as Record<string, unknown>)) {
      if (!['sm', 'md', 'lg', 'xl', '2xl'].includes(k)) continue;
      if (typeof v !== 'string' || !RADIUS.test(v.trim())) {
        throw new ThemeFileError(`Invalid radius for "${k}" - use a value like "12px" or "0.75rem".`);
      }
      shape[k as keyof NonNullable<CustomTheme['shape']>] = v.trim();
    }
  }

  let density: CustomTheme['density'];
  if (typeof definition.density === 'string') {
    if (!DENSITIES.has(definition.density)) {
      throw new ThemeFileError('density must be one of: compact, normal, spacious.');
    }
    density = definition.density as CustomTheme['density'];
  }

  // Asset references must point at files the package actually contains.
  // A dangling reference would render as a broken image with no clue why.
  const assets: Record<string, string> = {};
  const rawAssets = definition.assets;
  if (rawAssets && typeof rawAssets === 'object' && !Array.isArray(rawAssets)) {
    for (const [role, path] of Object.entries(rawAssets as Record<string, unknown>)) {
      if (typeof path !== 'string') continue;
      if (!assetPaths.includes(path)) {
        throw new ThemeFileError(`The theme references an asset that is not in the package: ${path.slice(0, 60)}`);
      }
      assets[role.slice(0, 30)] = path;
    }
  }

  // The Home composition, if the theme defines one. A layout naming a
  // widget this build does not have is NOT fatal - parseLayout drops it
  // and reports it, so a theme written for a newer VanOS loses one tile
  // rather than the whole page. A layout trying to express CSS IS
  // fatal, and the error says why.
  let heroContent: CustomTheme['heroContent'];
  const rawHero = definition.hero;
  if (rawHero && typeof rawHero === 'object' && !Array.isArray(rawHero)) {
    const h = rawHero as Record<string, unknown>;
    const clean = (v: unknown, max: number) => typeof v === 'string' ? v.slice(0, max) : undefined;
    heroContent = {
      eyebrow: clean(h.eyebrow, 80),
      title: clean(h.title, 120),
      subtitle: clean(h.subtitle, 160),
      quote: clean(h.quote, 180),
      quoteAuthor: clean(h.quoteAuthor, 80),
    };
    if (!Object.values(heroContent).some(Boolean)) heroContent = undefined;
  }

  let homeLayout: LayoutDefinition | undefined;
  let unknownWidgets: string[] | undefined;
  const rawHome = definition.home;
  if (rawHome && typeof rawHome === 'object' && !Array.isArray(rawHome)) {
    const rawLayout = (rawHome as Record<string, unknown>).layout;
    if (rawLayout !== undefined) {
      try {
        const parsed = parseLayout(rawLayout, knownWidgets);
        homeLayout = parsed.layout;
        if (parsed.skipped.length) unknownWidgets = parsed.skipped;
      } catch (err) {
        throw new ThemeFileError(err instanceof Error ? err.message : 'That theme has an invalid home layout.');
      }
    }
  }

  return {
    ...base,
    formatVersion: 1,
    homeLayout,
    unknownWidgets,
    author: manifest.author ?? base.author,
    description: manifest.description,
    typography: Object.keys(typography).length ? typography : undefined,
    shape: Object.keys(shape).length ? shape : undefined,
    density,
    assets: Object.keys(assets).length ? assets : undefined,
    previewPath: manifest.preview,
    cockpit: (
      typeof definition.cockpit === 'string' &&
      ['instrument', 'adventure', 'control'].includes(definition.cockpit)
    ) ? definition.cockpit : undefined,
    heroContent,
    heroCamera: (
      typeof definition.home === 'object' &&
      definition.home !== null &&
      !Array.isArray(definition.home) &&
      typeof (definition.home as Record<string, unknown>).heroCamera === 'boolean'
    ) ? (definition.home as Record<string, unknown>).heroCamera as boolean : undefined,
  };
}

/** Applies a custom theme's tokens to <html>.
 *
 *  setProperty only - never innerHTML, never a generated <style> block.
 *  Values are already validated, and this API cannot execute anything
 *  even if one slipped through. */
export function applyCustomTheme(theme: CustomTheme | null): void {
  const root = document.documentElement;

  // Clear everything a theme could have set, so switching themes never
  // leaves a previous theme's value behind.
  for (const token of THEMEABLE_TOKENS) root.style.removeProperty(`--${token}`);
  for (const slot of ['sans', 'display', 'mono']) root.style.removeProperty(`--font-${slot}`);
  for (const r of ['sm', 'md', 'lg', 'xl', '2xl']) root.style.removeProperty(`--radius-${r}`);
  root.style.removeProperty('--density');

  if (!theme) return;

  for (const [token, value] of Object.entries(theme.tokens)) {
    if (TOKEN_SET.has(token)) root.style.setProperty(`--${token}`, value);
  }
  // A theme names a font CHOICE; the stack itself comes from our table,
  // never from the file.
  for (const [slot, choice] of Object.entries(theme.typography ?? {})) {
    const stack = FONT_CHOICES[choice];
    if (stack) root.style.setProperty(`--font-${slot}`, stack);
  }
  for (const [k, v] of Object.entries(theme.shape ?? {})) {
    root.style.setProperty(`--radius-${k}`, v);
  }
  if (theme.density) {
    root.style.setProperty('--density', DENSITY_SCALE[theme.density] ?? '1');
  }
}

/** The key the removed browser-local theme mechanism used.
 *
 *  Kept only so the Control Panel can notice leftovers and say what
 *  happened, rather than letting someone's themes vanish silently. There
 *  is deliberately no converter: the only files that ever used this were
 *  test artefacts, and a converter would keep the second meaning of
 *  "theme" alive in the code in order to translate it. */
export const LEGACY_THEME_KEY = 'vanos-custom-themes';

/** True when this browser still holds themes from the removed
 *  JSON-file mechanism. */
export function hasLegacyLocalThemes(): boolean {
  try {
    const raw = window.localStorage.getItem(LEGACY_THEME_KEY);
    if (!raw) return false;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

/** Forget them, once the user has been told. */
export function clearLegacyLocalThemes(): void {
  try {
    window.localStorage.removeItem(LEGACY_THEME_KEY);
  } catch {
    // Nothing to do - a browser that will not let us remove it will not
    // have let us read it either.
  }
}
