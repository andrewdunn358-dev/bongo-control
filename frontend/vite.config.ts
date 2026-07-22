import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

/**
 * Stamps a unique build id into the emitted service worker, replacing
 * the __BUILD_ID__ placeholder in public/service-worker.js. Without this
 * the SW bytes are identical on every build, so the browser never
 * detects a new version and long-lived PWAs (the van dashboard, left
 * running for days) stay pinned to an old build. Runs on build only;
 * in dev the SW isn't registered anyway (see index.html).
 */
function swVersion() {
  return {
    name: 'sw-version',
    apply: 'build' as const,
    closeBundle() {
      const swPath = path.resolve(__dirname, 'dist/service-worker.js');
      if (!fs.existsSync(swPath)) return;
      const buildId = `${Date.now().toString(36)}`;
      const src = fs.readFileSync(swPath, 'utf8').replace(/__BUILD_ID__/g, buildId);
      fs.writeFileSync(swPath, src);
      // eslint-disable-next-line no-console
      console.log(`[sw-version] service worker stamped with build id ${buildId}`);
    },
  };
}

// Emergent sandbox constraints:
// - Ingress routes /api/* to the backend on :8001.
// - Anything else (including /ws/*) is routed to the frontend on :3000.
// - To let the sandbox preview drive the mock backend's WebSocket, we
//   proxy /api/ws/* through the Vite dev server to the backend.
// The frontend code uses `import.meta.env.DEV ? "/api/ws/telemetry" : "/ws/telemetry"`
// (see src/lib/config.ts) so prod nginx serves the WS at its canonical path.
export default defineConfig({
  plugins: [react(), swVersion()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
        ws: true,
      },
    },
    watch: {
      ignored: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
    },
    hmr: {
      // Emergent preview terminates TLS externally on 443
      clientPort: 443,
      protocol: 'wss',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2020',
    // Pi is armv7 — keep the bundle lean
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          maplibre: ['maplibre-gl'],
          recharts: ['recharts'],
          motion: ['framer-motion'],
        },
      },
    },
  },
});
