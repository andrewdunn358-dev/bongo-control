import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Emergent sandbox constraints:
// - Ingress routes /api/* to the backend on :8001.
// - Anything else (including /ws/*) is routed to the frontend on :3000.
// - To let the sandbox preview drive the mock backend's WebSocket, we
//   proxy /api/ws/* through the Vite dev server to the backend.
// The frontend code uses `import.meta.env.DEV ? "/api/ws/telemetry" : "/ws/telemetry"`
// (see src/lib/config.ts) so prod nginx serves the WS at its canonical path.
export default defineConfig({
  plugins: [react()],
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
