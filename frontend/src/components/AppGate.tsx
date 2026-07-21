import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { api, getToken, setToken, ApiError } from '@/lib/api';
import { GlassCard } from '@/components/primitives/GlassCard';

/**
 * App-wide password gate.
 *
 * Replaces the per-screen lock that used to live on Camera. One gate is
 * both simpler and safer: previously Camera and Switches each hit a 401
 * independently, which meant Switches showed a confusing empty state
 * and told you to go unlock somewhere else. Now nothing renders until
 * a token exists, so no screen ever has to handle "locked" itself.
 *
 * Completely inert when no password is configured — /api/auth/status
 * returns {required: false} and this renders children immediately.
 * Existing deployments without APP_ACCESS_PASSWORD set see no change.
 */
export function AppGate({ children }: { children: React.ReactNode }) {
  const [token, setTok] = useState(getToken());
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = useQuery({
    queryKey: ['auth-status'],
    queryFn: api.authStatus,
    // Asked once per load. Whether a password is configured doesn't
    // change while the app is open.
    staleTime: Infinity,
    retry: 1,
  });

  // Re-check on focus in case the token was cleared in another tab.
  useEffect(() => {
    const onFocus = () => setTok(getToken());
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const unlock = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.unlock(password);
      setToken(r.token);
      setTok(r.token);
      setPassword('');
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? 'Wrong password.' : "Couldn't reach the backend.");
    } finally {
      setBusy(false);
    }
  };

  // Render nothing while we find out whether a gate is even needed -
  // briefly flashing a lock screen at people who don't have a password
  // configured would be a confusing regression.
  if (status.isLoading) return null;

  const required = status.data?.required === true;
  if (!required || token) return <>{children}</>;

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <GlassCard glow="purple" className="p-8 w-full max-w-md">
        <div className="flex flex-col items-center text-center">
          <div className="h-16 w-16 rounded-2xl grid place-items-center bg-aurora-purple/15 ring-1 ring-aurora-purple/40 text-aurora-purple">
            <Lock size={26} />
          </div>
          <h1 className="text-xl font-semibold mt-4">Bongo Control</h1>
          <p className="text-sm text-ink-muted mt-1">Enter the shared password to continue.</p>

          <div className="mt-6 w-full">
            <input
              type="password"
              value={password}
              autoFocus
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && password && !busy && unlock()}
              placeholder="Password"
              className="w-full rounded-xl bg-ink/[0.04] ring-1 ring-ink/10 focus:ring-aurora-teal/60 outline-none px-4 py-3"
            />
            {error && <div className="text-status-red text-sm mt-2">{error}</div>}
            <button
              type="button"
              onClick={unlock}
              disabled={busy || !password}
              className="mt-3 w-full rounded-xl bg-gradient-to-r from-aurora-teal to-aurora-purple text-navy-900 font-semibold py-3 disabled:opacity-40 hover:brightness-110"
            >
              {busy ? 'Checking…' : 'Unlock'}
            </button>
            <p className="text-[11px] text-ink-faint mt-4">
              Asked once per device. The token is stored locally and reused.
            </p>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
