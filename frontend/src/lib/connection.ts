/**
 * CONNECTION - local first, remote as the fallback.
 *
 * VanOS is served from two addresses, the same frontend and backend
 * behind each, with the same relative /api and /ws paths:
 *   LOCAL   http://192.168.1.134:8090   direct to the Pi, on the van's network
 *   REMOTE  the https address through the Cloudflare tunnel
 *
 * WHY THE PAGE MOVES rather than just the API base: browsers do not let
 * an https page talk to a plain-http address on a private network (mixed
 * content, and Chrome's private-network rules), and the Pi has no
 * certificate. So the only way to use the local connection is to BE on
 * the local page. Switching endpoint therefore means moving the page
 * between the two addresses, carrying the login in the URL fragment (a
 * fragment never reaches any server) so nobody logs in twice.
 *
 * The rules:
 *   on REMOTE - if the backend says this device is on the van's network
 *               (see backend /api/system/local-address), move to LOCAL.
 *               If REMOTE stops answering, move to LOCAL too: with no
 *               signal at the van it is the only thing that can work.
 *   on LOCAL  - stay while the Pi answers. If it stops (left the van's
 *               WiFi), move to REMOTE.
 *
 * Each move shows a short notice with "Stay here". A page just arrived
 * at by a move does not move back for a while, so a van that is down on
 * both addresses cannot make the page bounce between them.
 */
import { useEffect, useState } from 'react';
import { api, getToken, setToken } from './api';
import { isDemo } from './demo';

/** The Pi's permanent address on the van's network. The backend reports
 *  it too, and a reported address takes over from this one. */
export const DEFAULT_LOCAL_URL = 'http://192.168.1.134:8090';

const LOCAL_URL_KEY = 'vanos.local.url';
const REMOTE_URL_KEY = 'vanos.remote.url';
const NO_MOVE_UNTIL_KEY = 'vanos.connection.noMoveUntil';
const P_TOKEN = 'vanos-token';
const P_REMOTE = 'vanos-remote';
const P_MOVED = 'vanos-moved';

const CHECK_EVERY_MS = 15_000;
const FAILS_BEFORE_MOVE = 2;
/** After arriving by a move, don't move again for this long. */
const SETTLE_MS = 2 * 60_000;
export const MOVE_COUNTDOWN_S = 4;

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

export type ConnectionMode = 'local' | 'remote';

/** Which connection this page is using. The local address is plain http;
 *  the remote one is always https. */
export function connectionMode(): ConnectionMode {
  return typeof window !== 'undefined' && window.location.protocol === 'http:' ? 'local' : 'remote';
}

export const localUrl = () => read(LOCAL_URL_KEY) || DEFAULT_LOCAL_URL;

/** Call once at startup, before anything reads the token: take over what
 *  a move carried in the URL fragment, then strip it from the address bar
 *  and history. */
export function adoptMoveParams() {
  if (typeof window === 'undefined') return;
  const hash = window.location.hash;
  if (!hash.includes('vanos-')) return;
  const params = new URLSearchParams(hash.slice(1));
  const token = params.get(P_TOKEN);
  const remote = params.get(P_REMOTE);
  if (token) setToken(token);
  if (remote && /^https:\/\//.test(remote)) write(REMOTE_URL_KEY, remote);
  if (params.has(P_MOVED)) {
    write(NO_MOVE_UNTIL_KEY, String(Date.now() + SETTLE_MS));
    // A switch is not a fresh visit: skip the splash screen.
    try { sessionStorage.setItem('bongo.splash.seen', '1'); } catch { /* ignore */ }
  }
  for (const k of [P_TOKEN, P_REMOTE, P_MOVED]) params.delete(k);
  const rest = params.toString();
  window.history.replaceState(null, '', window.location.pathname + window.location.search + (rest ? `#${rest}` : ''));
}

/** Is the Pi answering at this page's address? A network error or a 5xx
 *  (the tunnel's own error page when the Pi is unreachable) both mean no. */
async function reachable(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch('/api/health', { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(timer);
    return res.status < 500;
  } catch {
    return false;
  }
}

function moveUrl(base: string): string {
  const { pathname, search } = window.location;
  const p = new URLSearchParams();
  const token = getToken();
  if (token) p.set(P_TOKEN, token);
  if (connectionMode() === 'remote') p.set(P_REMOTE, window.location.origin);
  p.set(P_MOVED, '1');
  return `${base.replace(/\/$/, '')}${pathname}${search}#${p.toString()}`;
}

export interface PendingMove {
  to: ConnectionMode;
  url: string;
  /** Why, in words for the notice. */
  reason: string;
}

export function useConnection() {
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [stayed, setStayed] = useState(false);

  useEffect(() => {
    if (isDemo) return;
    const mode = connectionMode();
    let stop = false;
    let fails = 0;
    const settled = () => Date.now() >= Number(read(NO_MOVE_UNTIL_KEY) || 0);
    const propose = (m: PendingMove) => { if (settled()) setPending(m); };

    const tick = async () => {
      const ok = await reachable();
      if (stop) return;

      if (ok) {
        fails = 0;
        if (mode === 'remote') {
          // Learn the local address, and whether we are next to the van.
          try {
            const { url, same_network } = await api.localAddress();
            if (stop) return;
            if (url) write(LOCAL_URL_KEY, url);
            if (same_network) {
              propose({ to: 'local', url: localUrl(), reason: "This device is on the van's network, so connecting directly to the Pi." });
            }
          } catch { /* not logged in yet, or an older backend */ }
        }
        return;
      }

      fails += 1;
      // Check again soon rather than in 15s, so a lost connection is
      // acted on within seconds.
      if (fails === 1) setTimeout(() => { if (!stop) void tick(); }, 3000);
      if (fails < FAILS_BEFORE_MOVE) return;
      if (mode === 'remote') {
        propose({ to: 'local', url: localUrl(), reason: "Can't reach the van over the internet. Trying the direct connection - this works on the van's WiFi." });
      } else {
        const remote = read(REMOTE_URL_KEY);
        if (remote) propose({ to: 'remote', url: remote, reason: "Can't reach the Pi directly - this device may have left the van's WiFi. Switching to the internet connection." });
      }
    };

    void tick();
    const id = setInterval(tick, CHECK_EVERY_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { stop = true; clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  useEffect(() => {
    if (!pending || stayed) return;
    const id = setTimeout(() => window.location.replace(moveUrl(pending.url)), MOVE_COUNTDOWN_S * 1000);
    return () => clearTimeout(id);
  }, [pending, stayed]);

  return {
    pending: stayed ? null : pending,
    goNow: () => { if (pending) window.location.replace(moveUrl(pending.url)); },
    stay: () => setStayed(true),
  };
}
