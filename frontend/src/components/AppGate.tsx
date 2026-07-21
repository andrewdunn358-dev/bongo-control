import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { api, getToken, setToken, ApiError } from '@/lib/api';

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
    // Explicit colours throughout rather than inherited tokens. This
    // screen renders OUTSIDE NavShell and is the only thing on screen
    // when it appears - if its contrast is wrong there is no way for
    // the user to recover, because they can't reach Settings to change
    // the theme. Belt and braces: it must be readable in both themes
    // even if a token resolves unexpectedly.
    <div className="min-h-screen grid place-items-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-aurora-purple/30 bg-[#0f2942] p-8 shadow-[0_24px_60px_rgba(2,8,20,0.6)]">
        <div className="flex flex-col items-center text-center">
          <div className="h-16 w-16 rounded-2xl grid place-items-center bg-aurora-purple/20 ring-1 ring-aurora-purple/50">
            <Lock size={26} className="text-[#c4b5fd]" />
          </div>
          <h1 className="text-xl font-semibold mt-4 text-[#e6f0ff]">Bongo Control</h1>
          <p className="text-sm mt-1 text-[#94a8c2]">Enter the shared password to continue.</p>

          <div className="mt-6 w-full">
            <input
              type="password"
              value={password}
              autoFocus
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && password && !busy && unlock()}
              placeholder="Password"
              className="w-full rounded-xl px-4 py-3 outline-none bg-[#0a1628] text-[#e6f0ff] placeholder:text-[#8296b0] border border-[#264c7a] focus:border-aurora-teal"
            />
            {error && <div className="text-sm mt-2 text-[#f87171]">{error}</div>}
            <button
              type="button"
              onClick={unlock}
              disabled={busy || !password}
              /* Solid teal rather than a gradient, and a mid-navy
                 disabled state rather than opacity - a 40%-opacity
                 gradient on a dark card was almost invisible, which
                 made the button look broken before anything was typed. */
              className="mt-3 w-full rounded-xl py-3 font-semibold transition enabled:bg-aurora-teal enabled:text-[#06202b] enabled:hover:brightness-110 disabled:bg-[#1a3d66] disabled:text-[#a9bdd6] disabled:cursor-not-allowed"
            >
              {busy ? 'Checking…' : 'Unlock'}
            </button>
            <p className="text-[11px] mt-4 text-[#8296b0]">
              Asked once per device. The token is stored locally and reused.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
