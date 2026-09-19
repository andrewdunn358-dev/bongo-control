/**
 * LOCAL FALLBACK - when the van can't be reached over the internet, switch
 * to its address on the van's own network by itself.
 *
 * While the internet address works, the app asks the backend for the
 * Pi's local address (/api/system/local-address) and remembers it. If the
 * internet address then stops answering - no signal at the van, tunnel
 * down - the service worker still opens the app from its cache, this
 * notices the API is unreachable and moves the page to the local address,
 * carrying the login across so nobody has to type the password again.
 *
 * It can only work if the phone is on the van's WiFi, and only after the
 * app has been opened once online since this shipped (to learn the
 * address). It never runs on the local address itself (http), or in the
 * demo build.
 *
 * Moving is a top-level navigation, which browsers allow from https to
 * http. A background probe of the local address first is not possible:
 * an https page may not fetch http (mixed content).
 */
import { useEffect, useState } from 'react';
import { api, getToken, setToken } from './api';
import { isDemo } from './demo';

const LOCAL_URL_KEY = 'vanos.local.url';
const TOKEN_PARAM = 'vanos-token';
const CHECK_EVERY_MS = 15_000;
/** Consecutive failed checks before switching - one blip is not an outage. */
const FAILS_BEFORE_SWITCH = 2;
/** Seconds the notice shows before switching, so it can be cancelled. */
export const SWITCH_COUNTDOWN_S = 5;

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

/** Only the internet copy of the app falls back; the local copy is http. */
const eligible = () => !isDemo && typeof window !== 'undefined' && window.location.protocol === 'https:';

/** On the local address: take over the login passed in the URL fragment,
 *  then remove it from the address bar and history. Call once at startup,
 *  before anything reads the token. */
export function adoptTokenFromUrl() {
  if (typeof window === 'undefined') return;
  const hash = window.location.hash;
  if (!hash.includes(`${TOKEN_PARAM}=`)) return;
  const params = new URLSearchParams(hash.slice(1));
  const t = params.get(TOKEN_PARAM);
  if (t) setToken(t);
  params.delete(TOKEN_PARAM);
  const rest = params.toString();
  window.history.replaceState(null, '', window.location.pathname + window.location.search + (rest ? `#${rest}` : ''));
}

/** Is the van answering at this address? A network error or a 5xx (the
 *  tunnel's own error page when the Pi is unreachable) both mean no. */
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

function localTarget(base: string): string {
  const { pathname, search } = window.location;
  const token = getToken();
  return `${base}${pathname}${search}${token ? `#${TOKEN_PARAM}=${encodeURIComponent(token)}` : ''}`;
}

/** Drives the whole thing. Returns the local address while a switch is
 *  pending (for the notice), plus a way to stay put. */
export function useLocalFallback() {
  const [pending, setPending] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);

  // Learn the local address while online. Retried each check until it
  // succeeds, since it needs the login.
  useEffect(() => {
    if (!eligible()) return;
    let stop = false;
    let fails = 0;
    let learned = false;

    const tick = async () => {
      const ok = await reachable();
      if (stop) return;
      if (ok) {
        fails = 0;
        if (!learned) {
          try {
            const { url } = await api.localAddress();
            if (url) { write(LOCAL_URL_KEY, url); learned = true; }
          } catch { /* not logged in yet, or older backend - try again later */ }
        }
        return;
      }
      fails += 1;
      // Check again soon rather than in 15s, so opening the app with no
      // signal switches within a few seconds.
      if (fails === 1) setTimeout(() => { if (!stop) void tick(); }, 3000);
      const local = read(LOCAL_URL_KEY);
      if (fails >= FAILS_BEFORE_SWITCH && local) setPending(local);
    };

    void tick();
    const id = setInterval(tick, CHECK_EVERY_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { stop = true; clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  // Countdown, then go.
  useEffect(() => {
    if (!pending || cancelled) return;
    const id = setTimeout(() => window.location.replace(localTarget(pending)), SWITCH_COUNTDOWN_S * 1000);
    return () => clearTimeout(id);
  }, [pending, cancelled]);

  return {
    pending: cancelled ? null : pending,
    goNow: () => pending && window.location.replace(localTarget(pending)),
    stay: () => setCancelled(true),
  };
}
