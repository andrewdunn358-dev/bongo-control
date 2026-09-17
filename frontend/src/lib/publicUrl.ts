/**
 * Resolve a file in public/ against the build's base path.
 *
 * Vite rewrites asset URLs it can SEE - the ones in index.html, and
 * anything imported through the module graph. It cannot rewrite a path
 * that only exists as a runtime string, and this app has several:
 * `/hero/${image}.jpg` chosen from the weather, the cockpit's hero and
 * tile fallbacks, the splash photo, the demo camera frames. Those stay
 * literally '/hero/...' in the bundle.
 *
 * That is invisible on the Pi, where the app is served from the domain
 * root and '/hero/x.jpg' is correct. It is NOT invisible on the GitHub
 * Pages preview, which serves from /bongo-control/: every one of those
 * images 404s, and you get a cockpit with no photography in it - which
 * would make the preview useless for judging exactly the thing it is
 * most useful for. Found by serving a build under a subpath and
 * watching the network log, not by reading the code.
 *
 * BASE_URL is '/' in every normal build, so this is a no-op on the Pi
 * and in dev. It only does anything where the base actually differs.
 */
export function publicUrl(path: string): string {
  if (!path.startsWith('/')) return path;
  const base = import.meta.env.BASE_URL || '/';
  return base.endsWith('/') ? base + path.slice(1) : base + path;
}
