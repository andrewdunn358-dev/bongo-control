import { unzip } from 'fflate';

/**
 * PORTABLE THEME PACKAGES (.vanos-theme)
 *
 * A theme package is a ZIP of DATA AND ASSETS ONLY - no JavaScript, no
 * components, nothing executable. That is the property the whole design
 * rests on: a theme downloaded from a stranger cannot break the van's
 * dashboard, because there is no code path by which it could run.
 *
 *   Freeda-Bright.vanos-theme
 *   ├── manifest.json     format, version, name, author, preview
 *   ├── theme.json        tokens, typography, shape, background, assets
 *   └── assets/           png | jpg | webp | svg
 *
 * SVG SAFETY, which is the part worth understanding:
 * SVG can carry <script>, event handlers and <foreignObject>. Sanitising
 * that reliably is notoriously leaky. So this code never sanitises SVG
 * and never inlines it. Assets are only ever handed to the DOM as a blob
 * URL in an <img> or a CSS background-image, and browsers do not execute
 * scripts in SVG loaded that way. It is a structural boundary rather
 * than a filter that has to be kept ahead of new attacks.
 */

export const PACKAGE_FORMAT = 'vanos-theme';
export const SUPPORTED_VERSION = 1;

export const MAX_PACKAGE_BYTES = 8 * 1024 * 1024;
export const MAX_ASSET_BYTES = 2 * 1024 * 1024;
export const MAX_ASSETS = 12;

/** Extensions a package may contain. Anything else - .js, .html, .svgz,
 *  .exe - is rejected, not ignored, so a package cannot smuggle a file
 *  past by being quietly dropped. */
const ASSET_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

export class ThemePackageError extends Error {}

export interface ThemeManifest {
  format: string;
  version: number;
  name: string;
  author?: string;
  description?: string;
  preview?: string;
  theme: string;
}

export interface ThemeAsset {
  path: string;
  mime: string;
  bytes: Uint8Array;
}

export interface ParsedThemePackage {
  manifest: ThemeManifest;
  /** Raw theme definition - validated separately by customThemes. */
  definition: Record<string, unknown>;
  assets: ThemeAsset[];
}

function extOf(path: string): string {
  const i = path.lastIndexOf('.');
  return i < 0 ? '' : path.slice(i).toLowerCase();
}

/**
 * Rejects anything that could escape the package directory.
 *
 * Zip entries are attacker-controlled strings, and "../../etc/passwd" or
 * an absolute path is the classic zip-slip. Nothing here writes to a
 * filesystem, so the risk is lower than usual, but the paths are used as
 * lookup keys and a traversal string has no legitimate use in a theme.
 */
function safeRelativePath(path: string): boolean {
  if (!path || path.length > 200) return false;
  if (path.startsWith('/') || path.startsWith('\\')) return false;
  if (/^[a-zA-Z]:/.test(path)) return false;         // C:\...
  if (path.includes('\0')) return false;
  return !path.split(/[\\/]/).some((seg) => seg === '..' || seg === '.');
}

function readJson(files: Record<string, Uint8Array>, name: string): Record<string, unknown> {
  const raw = files[name];
  if (!raw) throw new ThemePackageError(`The package has no ${name}.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new ThemePackageError(`${name} is not valid JSON.`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ThemePackageError(`${name} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function validateManifest(raw: Record<string, unknown>): ThemeManifest {
  const str = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string).trim() : '');

  if (str('format') !== PACKAGE_FORMAT) {
    throw new ThemePackageError("That isn't a VanOS theme package (manifest.format is wrong).");
  }
  const version = typeof raw.version === 'number' ? raw.version : NaN;
  if (!Number.isInteger(version)) {
    throw new ThemePackageError('The package manifest has no version number.');
  }
  // Explicit rejection rather than a partial load: a newer package may
  // rely on capabilities this build does not have, and half-applying it
  // would look like a bug rather than an unsupported file.
  if (version > SUPPORTED_VERSION) {
    throw new ThemePackageError(
      `This theme needs a newer version of VanOS (package format v${version}, this build supports v${SUPPORTED_VERSION}).`,
    );
  }

  const name = str('name');
  if (!name) throw new ThemePackageError('The package manifest has no name.');
  if (name.length > 40) throw new ThemePackageError('That theme name is too long (40 characters max).');

  const theme = str('theme') || 'theme.json';
  if (!safeRelativePath(theme)) throw new ThemePackageError('The manifest points at an unsafe theme path.');

  const preview = str('preview');
  if (preview && !safeRelativePath(preview)) {
    throw new ThemePackageError('The manifest points at an unsafe preview path.');
  }

  return {
    format: PACKAGE_FORMAT,
    version,
    name,
    author: str('author').slice(0, 60) || undefined,
    description: str('description').slice(0, 200) || undefined,
    preview: preview || undefined,
    theme,
  };
}

function unzipAsync(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(data, (err, files) => {
      if (err) reject(new ThemePackageError("That file isn't a readable .vanos-theme package (bad zip)."));
      else resolve(files);
    });
  });
}

/**
 * Parses and validates a .vanos-theme package.
 *
 * Throws ThemePackageError with a message written for a person. Never
 * partially loads: a package is entirely valid or entirely rejected.
 */
export async function parseThemePackage(data: Uint8Array): Promise<ParsedThemePackage> {
  if (data.byteLength > MAX_PACKAGE_BYTES) {
    throw new ThemePackageError(
      `That package is too large (${(data.byteLength / 1024 / 1024).toFixed(1)}MB, limit ${MAX_PACKAGE_BYTES / 1024 / 1024}MB).`,
    );
  }

  const files = await unzipAsync(data);

  for (const path of Object.keys(files)) {
    if (path.endsWith('/')) continue; // directory entry
    if (!safeRelativePath(path)) {
      throw new ThemePackageError(`The package contains an unsafe file path: ${path.slice(0, 60)}`);
    }
  }

  const manifest = validateManifest(readJson(files, 'manifest.json'));
  const definition = readJson(files, manifest.theme);

  const assets: ThemeAsset[] = [];
  for (const [path, bytes] of Object.entries(files)) {
    if (path.endsWith('/')) continue;
    if (path === 'manifest.json' || path === manifest.theme) continue;
    // README and similar are ignored rather than rejected - they are
    // useful to a human reading the package and harmless here.
    if (path.toLowerCase().endsWith('.md') || path.toLowerCase().endsWith('.txt')) continue;

    const mime = ASSET_TYPES[extOf(path)];
    if (!mime) {
      throw new ThemePackageError(
        `The package contains a file type that themes may not include: ${path.slice(0, 60)}. ` +
          'Only png, jpg, webp and svg are allowed.',
      );
    }
    if (bytes.byteLength > MAX_ASSET_BYTES) {
      throw new ThemePackageError(`${path} is too large (limit ${MAX_ASSET_BYTES / 1024 / 1024}MB per asset).`);
    }
    assets.push({ path, mime, bytes });
  }

  if (assets.length > MAX_ASSETS) {
    throw new ThemePackageError(`That package has too many assets (${assets.length}, limit ${MAX_ASSETS}).`);
  }
  if (manifest.preview && !assets.some((a) => a.path === manifest.preview)) {
    throw new ThemePackageError(`The manifest names a preview (${manifest.preview}) that is not in the package.`);
  }

  return { manifest, definition, assets };
}
