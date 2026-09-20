import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * THE THEME STUDIO'S OWN BUILD.
 *
 * Separate on purpose. The van's app is built by vite.config.ts and
 * contains no Studio: no route, no chunk, nothing to stumble into on
 * the tablet. This config builds studio.html alone, into dist-studio/,
 * for uploading to the public site (see site/README.md).
 *
 * VITE_DEMO is forced on: with no Pi behind it the widgets must draw
 * the in-browser simulation rather than sit at dashes, and api calls
 * must not go anywhere. The Studio hides "Install on the van" in this
 * mode - a page on the public site cannot reach a Pi on your own
 * network, and pretending otherwise would be the same dishonesty this
 * whole tool exists to remove.
 */
export default defineConfig({
  base: './',
  define: { 'import.meta.env.VITE_DEMO': '"true"' },
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  build: {
    outDir: 'dist-studio',
    rollupOptions: { input: path.resolve(__dirname, 'studio.html') },
  },
});
