import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, getStoredAppToken, setStoredAppToken } from "../services/api";

interface AuthContextValue {
  /** True once we know whether the app is actually locked and (if so) unlocked. */
  ready: boolean;
  /** Whether a password is configured server-side at all - if false, the gate is a no-op. */
  required: boolean;
  unlocked: boolean;
  unlock: (password: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue>({
  ready: false,
  required: false,
  unlocked: true,
  unlock: async () => false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [required, setRequired] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    api.auth
      .status()
      .then((status) => {
        setRequired(status.required);
        // Already have a token from a previous unlock - assume it's
        // still valid; if it's actually been revoked, the first
        // protected request will 401 and the person can re-unlock then,
        // rather than every page load re-validating it just to render.
        setUnlocked(!status.required || Boolean(getStoredAppToken()));
      })
      .catch(() => {
        // Status check itself failed (backend unreachable, etc.) - fail
        // open rather than lock someone out due to a network blip; a
        // genuinely protected route will still correctly 401 regardless.
        setRequired(false);
        setUnlocked(true);
      })
      .finally(() => setReady(true));
  }, []);

  const unlock = async (password: string): Promise<boolean> => {
    try {
      const { token } = await api.auth.unlock(password);
      setStoredAppToken(token);
      setUnlocked(true);
      return true;
    } catch {
      return false;
    }
  };

  return <AuthContext.Provider value={{ ready, required, unlocked, unlock }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
