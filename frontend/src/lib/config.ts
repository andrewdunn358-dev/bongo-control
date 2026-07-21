/**
 * WebSocket path shim.
 *
 * The real backend serves telemetry at `/ws/telemetry` (nginx proxies it
 * with a 24h idle timeout). The Emergent development sandbox, however,
 * routes only `/api/*` to the backend — everything else goes to the Vite
 * dev server. To keep both environments driving the same code, we resolve
 * the path against `import.meta.env.DEV`, which is provably `false` in any
 * production build (Vite constant-folds it), so this cannot leak.
 *
 * DO NOT introduce a VITE_WS_URL / REACT_APP_BACKEND_URL. Same-origin
 * relative paths are load-bearing: the app has to work identically on the
 * LAN and through the Cloudflare Tunnel with no rebuild between them.
 */
export const TELEMETRY_WS_PATH = import.meta.env.DEV
  ? '/api/ws/telemetry'
  : '/ws/telemetry';

/** REST base — always same-origin, relative. */
export const API_BASE = '/api';
