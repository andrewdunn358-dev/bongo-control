/**
 * The regression test for "maps are a black rectangle offline".
 *
 * Reasoning about service worker lifecycles is how this bug got shipped
 * in the first place, so this proves it in a real browser instead:
 * build A is served, the worker installs and caches a map tile, build B
 * replaces it on disk, the worker updates and activates - and the tile
 * must still be there afterwards. Before the fix, activate() deleted
 * every cache that wasn't the current build's, which was all of them.
 *
 * Deliberately NOT part of `npm run test:maps` or the Docker build: it
 * needs playwright and a browser, and the Pi that builds this image has
 * no business downloading Chromium. Run it on a laptop:
 *
 *   npm i -D playwright && npx playwright install chromium
 *   npm run build && cp -r dist /tmp/vanos-A
 *   npm run build && cp -r dist /tmp/vanos-B     # new build id = a "deploy"
 *   cp -r /tmp/vanos-A /tmp/vanos-live
 *   node tests/deploy-cache-survival.playwright.mjs
 *
 * Override the paths with LIVE_DIR / NEXT_BUILD_DIR, and the browser
 * binary with CHROMIUM_PATH, if your layout differs.
 *
 * Confirmed to FAIL against the pre-fix worker (restore `k !== VERSION`
 * in activate() to see it), which is the only reason to trust it.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const PORT = Number(process.env.PORT || 8765);
const LIVE = process.env.LIVE_DIR || '/tmp/vanos-live';
const NEXT_BUILD = process.env.NEXT_BUILD_DIR || '/tmp/vanos-B';
const ORIGIN = `http://127.0.0.1:${PORT}`;

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', LIVE], {
  stdio: 'ignore',
});
const stop = () => server.kill();
process.on('exit', stop);
await new Promise((r) => setTimeout(r, 800));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const context = await browser.newContext();
const page = await context.newPage();

try {
  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });

  // index.html deliberately skips registration on 127.0.0.1, so register
  // the real worker by hand. Same file, same code paths.
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.register('/service-worker.js');
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    }
    return reg.scope;
  });

  const before = await page.evaluate(() => caches.keys());
  const shellA = before.find((k) => k.startsWith('bongo-shell-'));
  assert.ok(shellA, `build A shell cache exists: ${JSON.stringify(before)}`);

  // Stand in for a saved tile. Using the real cache name is the point:
  // this is exactly what a "Save this area" press leaves behind.
  await page.evaluate(async () => {
    const cache = await caches.open('bongo-maps-v1');
    await cache.put(
      'https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/12/2010/1306.mvt',
      new Response('tile-bytes'),
    );
  });

  // --- deploy build B over the top ---
  fs.rmSync(LIVE, { recursive: true, force: true });
  fs.cpSync(NEXT_BUILD, LIVE, { recursive: true });

  const activated = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    await reg.update();
    const waiting = reg.waiting || (await new Promise((resolve) => {
      if (reg.waiting) return resolve(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed') resolve(sw);
        });
      });
      setTimeout(() => resolve(null), 15000);
    }));
    if (!waiting) return 'no-update';
    // Exactly what the in-app UpdateBanner's Reload button does.
    waiting.postMessage({ type: 'SKIP_WAITING' });
    await new Promise((resolve) => {
      if (waiting.state === 'activated') return resolve();
      waiting.addEventListener('statechange', () => waiting.state === 'activated' && resolve());
      setTimeout(resolve, 15000);
    });
    return waiting.state;
  });
  assert.equal(activated, 'activated', 'build B service worker activated');

  const after = await page.evaluate(() => caches.keys());
  const survived = await page.evaluate(async () => {
    const hit = await caches.match('https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/12/2010/1306.mvt');
    return hit ? await hit.text() : null;
  });

  // The fix.
  assert.ok(after.includes('bongo-maps-v1'), `map cache survived the deploy: ${JSON.stringify(after)}`);
  assert.equal(survived, 'tile-bytes', 'the saved tile itself is still readable');
  // And the old shell cache is still cleaned up - we kept the tidying,
  // we just stopped it eating the maps.
  assert.ok(!after.includes(shellA), `stale shell cache ${shellA} was purged: ${JSON.stringify(after)}`);
  assert.ok(
    after.some((k) => k.startsWith('bongo-shell-') && k !== shellA),
    'build B has its own shell cache',
  );

  console.log('deploy survival: PASS');
  console.log('  before:', before.join(', '));
  console.log('  after: ', after.join(', '));
} finally {
  await browser.close();
  stop();
}
