/**
 * CUSTOM THEME FILES
 *
 * A theme is DATA, not code: a small JSON file of colour tokens that
 * can be uploaded in Settings and applied instantly, with no rebuild
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
 * Parses and validates an uploaded theme file. Throws ThemeFileError
 * with a message meant for a person, not a stack trace.
 */
export function parseThemeFile(raw: string): CustomTheme {
  if (raw.length > MAX_THEME_FILE_BYTES) {
    throw new ThemeFileError('That file is too large to be a theme (32KB limit).');
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new ThemeFileError("That doesn't look like a theme file (not valid JSON).");
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new ThemeFileError('A theme file must be a JSON object.');
  }

  const obj = data as Record<string, unknown>;

  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  if (!name) throw new ThemeFileError('The theme file has no "name".');
  if (name.length > 40) throw new ThemeFileError('That theme name is too long (40 characters max).');

  return parseThemeDefinition(name, obj);
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

  return {
    ...base,
    formatVersion: 1,
    author: manifest.author ?? base.author,
    description: manifest.description,
    typography: Object.keys(typography).length ? typography : undefined,
    shape: Object.keys(shape).length ? shape : undefined,
    density,
    assets: Object.keys(assets).length ? assets : undefined,
    previewPath: manifest.preview,
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

const STORAGE_KEY = 'vanos-custom-themes';

export function loadCustomThemes(): CustomTheme[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Re-validate on read: a file that was valid when uploaded may have
    // been edited in localStorage by hand, and the token allow-list may
    // have changed between releases.
    return parsed.filter(
      (t): t is CustomTheme =>
        t && typeof t.id === 'string' && typeof t.name === 'string' && t.tokens && typeof t.tokens === 'object',
    );
  } catch {
    return [];
  }
}

export function saveCustomTheme(theme: CustomTheme): CustomTheme[] {
  const existing = loadCustomThemes().filter((t) => t.id !== theme.id);
  const next = [...existing, theme];
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    throw new ThemeFileError('Could not save the theme - browser storage is full or disabled.');
  }
  return next;
}

export function deleteCustomTheme(id: string): CustomTheme[] {
  const next = loadCustomThemes().filter((t) => t.id !== id);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* nothing useful to do; the list is still correct in memory */
  }
  return next;
}
