/**
 * THE THEME STUDIO'S MODEL.
 *
 * A draft theme, the package it becomes, and the checks the Pi will
 * apply to it. No React here, so the rules can be tested on their own.
 *
 * WHY THE CHECKS ARE DUPLICATED FROM THE BACKEND: they are not a second
 * opinion, they are an early one. The Pi remains the authority - it
 * re-validates every package on install and on every listing, and it is
 * the only side that can be trusted, since a package can arrive from
 * anywhere. Checking here only means the author is told while they can
 * still fix it, instead of after a failed upload. Where the two could
 * drift, the numbers below name the backend constant they mirror.
 */
import { FONT_CHOICES, THEMEABLE_TOKENS } from '@/lib/customThemes';
import { LAYOUT_COLUMNS, LAYOUT_VERSION, type LayoutDefinition } from '@/layout/schema';
import { createZip, readZip, ZipError, type ZipEntry } from '@/lib/zip';

/** theme_service.MAX_ASSETS / MAX_ASSET_BYTES. */
export const MAX_ASSETS = 12;
export const MAX_ASSET_BYTES = 2 * 1024 * 1024;
/** theme_service: manifest name length. */
export const MAX_NAME_LENGTH = 40;
/** The image types the Pi accepts. */
export const ASSET_TYPES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
};

/** Image roles VanOS actually asks for. A role not on this list is
 *  carried in the package and never drawn, which is how Galloway ended
 *  up with images nothing could use. */
export const ASSET_ROLES = [
  'hero',
  'battery',
  'solar',
  'power-flow',
  'weather',
  'heater',
  'roof',
  'switches',
  'camera',
] as const;

export const COCKPITS = ['adventure', 'instrument', 'control'] as const;
export const DENSITIES = ['compact', 'normal', 'spacious'] as const;

export interface DraftImage {
  role: string;
  /** File name inside the package, e.g. assets/hero.jpg */
  path: string;
  bytes: Uint8Array;
  /** Object URL, for the preview. */
  url: string;
  contentType: string;
}

export interface HeroCopy {
  eyebrow: string;
  title: string;
  subtitle: string;
  quote: string;
  quoteAuthor: string;
}

export interface ThemeDraft {
  name: string;
  author: string;
  description: string;
  tokens: Record<string, string>;
  typography: Partial<Record<'sans' | 'display' | 'mono', string>>;
  shape: Partial<Record<'sm' | 'md' | 'lg' | 'xl' | '2xl', string>>;
  density: (typeof DENSITIES)[number];
  cockpit: (typeof COCKPITS)[number];
  heroCamera: boolean;
  hero: HeroCopy;
  layout: LayoutDefinition;
  widgets: Record<string, { variant?: string }>;
  images: DraftImage[];
}

/** Same patterns the Pi enforces (theme_service._RGB / _BACKGROUND, and
 *  customThemes' RADIUS). */
const RGB_TRIPLET = /^\d{1,3}\s+\d{1,3}\s+\d{1,3}$/;
const SAFE_BACKGROUND = /^(linear-gradient|radial-gradient)\([#\w\s,.%()-]+\)$|^#[0-9a-fA-F]{3,8}$/;
const RADIUS = /^(0|[0-9]{1,2}(\.[0-9]{1,2})?(px|rem))$/;

export function slugFor(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'theme';
}

export function emptyDraft(): ThemeDraft {
  return {
    name: 'New theme',
    author: '',
    description: '',
    tokens: {},
    typography: {},
    shape: {},
    density: 'normal',
    cockpit: 'adventure',
    heroCamera: false,
    hero: { eyebrow: '', title: '', subtitle: '', quote: '', quoteAuthor: '' },
    layout: { version: LAYOUT_VERSION, items: [] },
    widgets: {},
    images: [],
  };
}

/** "R G B" <-> "#rrggbb", for the colour inputs. */
export function tripletToHex(triplet: string | undefined): string {
  const m = (triplet ?? '').trim().match(RGB_TRIPLET);
  if (!m) return '#000000';
  const [r, g, b] = triplet!.trim().split(/\s+/).map((n) => Math.max(0, Math.min(255, Number(n))));
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

export function hexToTriplet(hex: string): string {
  const m = hex.trim().match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return '0 0 0';
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** The hero block, with empty fields dropped - an empty string means
 *  "show nothing there", which is only worth carrying when some other
 *  field is set. */
function heroBlock(hero: HeroCopy): HeroCopy | undefined {
  return Object.values(hero).some((v) => v.trim()) ? hero : undefined;
}

/** The theme.json a draft becomes. Exported for the tests and for the
 *  Studio's "show me the file" view. */
export function themeDefinition(draft: ThemeDraft): Record<string, unknown> {
  const assets: Record<string, string> = {};
  for (const image of draft.images) assets[image.role] = image.path;

  const def: Record<string, unknown> = { tokens: draft.tokens };
  if (Object.keys(draft.typography).length) def.typography = draft.typography;
  if (Object.keys(draft.shape).length) def.shape = draft.shape;
  def.density = draft.density;
  def.cockpit = draft.cockpit;
  if (Object.keys(assets).length) def.assets = assets;
  const hero = heroBlock(draft.hero);
  if (hero) def.hero = hero;
  if (Object.keys(draft.widgets).length) def.widgets = draft.widgets;
  def.home = {
    heroCamera: draft.heroCamera,
    ...(draft.layout.items.length ? { layout: draft.layout } : {}),
  };
  return def;
}

export function manifestFor(draft: ThemeDraft): Record<string, unknown> {
  const manifest: Record<string, unknown> = {
    format: 'vanos-theme',
    version: 1,
    name: draft.name.trim(),
    theme: 'theme.json',
  };
  if (draft.author.trim()) manifest.author = draft.author.trim();
  if (draft.description.trim()) manifest.description = draft.description.trim();
  return manifest;
}

/** The package, exactly as the Pi will receive it. */
export function buildPackage(draft: ThemeDraft): Uint8Array {
  const enc = new TextEncoder();
  const entries: ZipEntry[] = [
    { path: 'manifest.json', data: enc.encode(JSON.stringify(manifestFor(draft), null, 2)) },
    { path: 'theme.json', data: enc.encode(JSON.stringify(themeDefinition(draft), null, 2)) },
    ...draft.images.map((i) => ({ path: i.path, data: i.bytes })),
  ];
  return createZip(entries);
}

export function packageFile(draft: ThemeDraft): File {
  const bytes = buildPackage(draft);
  return new File([bytes as BlobPart], `${slugFor(draft.name)}.vanos-theme`, { type: 'application/zip' });
}

export interface Problem {
  /** An error means the Pi would refuse the package. A warning means it
   *  would install and then not do what the author expects. */
  level: 'error' | 'warning';
  text: string;
}

export function validateDraft(draft: ThemeDraft, knownWidgets: readonly string[], variants: Record<string, string[]>): Problem[] {
  const problems: Problem[] = [];
  const err = (text: string) => problems.push({ level: 'error', text });
  const warn = (text: string) => problems.push({ level: 'warning', text });

  if (!draft.name.trim()) err('The theme needs a name.');
  if (draft.name.trim().length > MAX_NAME_LENGTH) err(`The name is too long (${MAX_NAME_LENGTH} characters max).`);

  const tokenCount = Object.values(draft.tokens).filter((v) => v.trim()).length;
  if (!tokenCount) err('A theme must set at least one colour.');
  for (const [token, value] of Object.entries(draft.tokens)) {
    if (!value.trim()) continue;
    if (!THEMEABLE_TOKENS.includes(token as (typeof THEMEABLE_TOKENS)[number])) {
      warn(`"${token}" is not a colour a theme can set; it will be ignored.`);
      continue;
    }
    const ok = token === 'aurora-base' ? SAFE_BACKGROUND.test(value.trim()) : RGB_TRIPLET.test(value.trim());
    if (!ok) err(`"${token}" is not a value the Pi will accept.`);
  }

  for (const choice of Object.values(draft.typography)) {
    if (choice && !FONT_CHOICES[choice]) err(`"${choice}" is not one of the fonts a theme may choose.`);
  }
  for (const [size, value] of Object.entries(draft.shape)) {
    if (value && !RADIUS.test(value)) err(`Corner radius "${size}" must be a length like 12px or 0.75rem.`);
  }

  for (const item of draft.layout.items) {
    if (!knownWidgets.includes(item.widget)) err(`"${item.widget}" is not a widget this build knows.`);
    const span = item.span ?? LAYOUT_COLUMNS;
    if (span < 1 || span > LAYOUT_COLUMNS) err(`"${item.widget}" has a span outside 1-${LAYOUT_COLUMNS}.`);
  }
  if (draft.layout.items.length > 24) err('A layout may hold at most 24 widgets.');

  for (const [widget, presentation] of Object.entries(draft.widgets)) {
    const choice = presentation.variant;
    if (!choice) continue;
    const allowed = variants[widget];
    if (!allowed) warn(`"${widget}" has no drawings to choose between; the setting does nothing.`);
    else if (!allowed.includes(choice)) err(`"${choice}" is not a drawing "${widget}" has.`);
  }

  if (draft.images.length > MAX_ASSETS) err(`Too many images (${draft.images.length}); the Pi accepts ${MAX_ASSETS}.`);
  for (const image of draft.images) {
    if (image.bytes.length > MAX_ASSET_BYTES) err(`${image.path} is over the ${MAX_ASSET_BYTES / 1024 / 1024}MB limit for one image.`);
    if (!Object.values(ASSET_TYPES).includes(image.path.slice(image.path.lastIndexOf('.')).toLowerCase())) {
      err(`${image.path} is a file type themes may not include.`);
    }
    if (!(ASSET_ROLES as readonly string[]).includes(image.role)) {
      warn(`Nothing in VanOS shows a "${image.role}" image, so it will never appear.`);
    }
  }

  // The conflict that made Galloway's own artwork invisible: a theme
  // that both names a drawing for a widget and supplies an image for
  // it. The drawing wins, so the image is never seen.
  for (const image of draft.images) {
    if (draft.widgets[image.role]?.variant) {
      warn(`"${image.role}" has both a drawing and an image. The drawing wins, so this image will not appear.`);
    }
  }

  if (draft.images.some((i) => i.role === 'hero') && draft.heroCamera) {
    warn('The hero shows the live camera, so the hero image will not appear. Turn the camera off for this theme.');
  }

  return problems;
}

/** Reads an existing .vanos-theme back into a draft, so a theme can be
 *  edited rather than only written once. Unknown fields are dropped
 *  here exactly as the Pi drops them, so what comes back is what the
 *  van would actually use - not what the file claims. */
export async function draftFromPackage(bytes: Uint8Array): Promise<ThemeDraft> {
  const files = await readZip(bytes);
  const dec = new TextDecoder();
  const readJson = (path: string): Record<string, unknown> => {
    const raw = files.get(path);
    if (!raw) throw new ZipError(`The package has no ${path}.`);
    const parsed = JSON.parse(dec.decode(raw));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ZipError(`${path} must be a JSON object.`);
    return parsed as Record<string, unknown>;
  };

  const manifest = readJson('manifest.json');
  if (manifest.format !== 'vanos-theme') throw new ZipError("That isn't a VanOS theme package.");
  const definition = readJson(typeof manifest.theme === 'string' ? manifest.theme : 'theme.json');

  const draft = emptyDraft();
  const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
  draft.name = str(manifest.name, 'Imported theme').slice(0, MAX_NAME_LENGTH);
  draft.author = str(manifest.author);
  draft.description = str(manifest.description);

  const tokens = definition.tokens;
  if (tokens && typeof tokens === 'object' && !Array.isArray(tokens)) {
    for (const [k, v] of Object.entries(tokens as Record<string, unknown>)) {
      if (typeof v === 'string') draft.tokens[k.replace(/^-+/, '')] = v;
    }
  }
  const typography = definition.typography;
  if (typography && typeof typography === 'object') {
    for (const slot of ['sans', 'display', 'mono'] as const) {
      const choice = (typography as Record<string, unknown>)[slot];
      if (typeof choice === 'string') draft.typography[slot] = choice;
    }
  }
  const shape = definition.shape;
  if (shape && typeof shape === 'object') {
    for (const size of ['sm', 'md', 'lg', 'xl', '2xl'] as const) {
      const value = (shape as Record<string, unknown>)[size];
      if (typeof value === 'string') draft.shape[size] = value;
    }
  }
  if (typeof definition.density === 'string' && (DENSITIES as readonly string[]).includes(definition.density)) {
    draft.density = definition.density as ThemeDraft['density'];
  }
  if (typeof definition.cockpit === 'string' && (COCKPITS as readonly string[]).includes(definition.cockpit)) {
    draft.cockpit = definition.cockpit as ThemeDraft['cockpit'];
  }

  const hero = definition.hero;
  if (hero && typeof hero === 'object' && !Array.isArray(hero)) {
    const h = hero as Record<string, unknown>;
    draft.hero = {
      eyebrow: str(h.eyebrow), title: str(h.title), subtitle: str(h.subtitle),
      quote: str(h.quote), quoteAuthor: str(h.quoteAuthor),
    };
  }

  const home = definition.home;
  if (home && typeof home === 'object' && !Array.isArray(home)) {
    const h = home as Record<string, unknown>;
    if (typeof h.heroCamera === 'boolean') draft.heroCamera = h.heroCamera;
    const layout = h.layout as { version?: unknown; items?: unknown } | undefined;
    if (layout && Array.isArray(layout.items)) {
      draft.layout = {
        version: LAYOUT_VERSION,
        items: layout.items
          .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
          .map((i) => ({
            widget: str(i.widget),
            ...(typeof i.span === 'number' ? { span: i.span } : {}),
            ...(typeof i.column === 'number' ? { column: i.column } : {}),
          }))
          .filter((i) => i.widget),
      };
    }
  }

  const widgets = definition.widgets;
  if (widgets && typeof widgets === 'object' && !Array.isArray(widgets)) {
    for (const [id, value] of Object.entries(widgets as Record<string, unknown>)) {
      const variant = value && typeof value === 'object' ? (value as Record<string, unknown>).variant : undefined;
      if (typeof variant === 'string') draft.widgets[id] = { variant };
    }
  }

  const assets = definition.assets;
  if (assets && typeof assets === 'object' && !Array.isArray(assets)) {
    for (const [role, path] of Object.entries(assets as Record<string, unknown>)) {
      if (typeof path !== 'string') continue;
      const bytesForRole = files.get(path);
      if (!bytesForRole) continue; // declared but absent: the same thing the app does - ignore it
      const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
      const contentType = Object.entries(ASSET_TYPES).find(([, e]) => e === ext)?.[0] ?? 'application/octet-stream';
      draft.images.push({ role, path, bytes: bytesForRole, contentType, url: objectUrl(bytesForRole, contentType) });
    }
  }

  return draft;
}

/** A URL for the preview. Returns '' where object URLs don't exist (a
 *  test runner), which simply means no image in that environment. */
export function objectUrl(bytes: Uint8Array, contentType: string): string {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return '';
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type: contentType }));
}
