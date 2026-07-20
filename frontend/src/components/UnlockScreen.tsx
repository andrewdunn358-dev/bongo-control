import { useState, type FormEvent } from "react";
import { Lock } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function UnlockScreen() {
  const { unlock } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    // Request location permission in the SAME user-initiated action as
    // unlocking, rather than a separate silent attempt later. Two
    // reasons this is genuinely better, not just tidier:
    //   1. Browsers are more willing to grant (and people more
    //      comfortable granting) a permission prompt tied to one clear
    //      deliberate action, versus something that fires on its own
    //      partway through using the app.
    //   2. Practically: once granted here, later automatic refreshes
    //      elsewhere (Nearby, Weather) shouldn't need to prompt again.
    // Best-effort and silent either way - denial here doesn't block
    // unlocking, and the rest of the app already fails soft if location
    // is unavailable.
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        () => {},
        () => {},
        { timeout: 8000 }
      );
    }

    const ok = await unlock(password);
    if (!ok) {
      setError("Incorrect password");
      setSubmitting(false);
    }
    // On success, AuthContext's unlocked state flips and this screen
    // unmounts - no need to reset submitting here.
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-base px-4">
      <div className="w-full max-w-xs rounded-2xl border border-ink/[0.08] bg-surface-card p-7 text-center shadow-[0_16px_40px_rgba(0,0,0,0.5)]">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-battery/12">
          <Lock size={20} className="text-battery" />
        </div>
        <h1 className="text-lg font-semibold text-text-primary">Bongo Control</h1>
        <p className="mt-1 text-sm text-text-secondary">Enter the password to continue</p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full rounded-lg border border-ink/10 bg-surface-raised px-3 py-2.5 text-center font-mono text-sm text-text-primary placeholder:text-text-muted focus:border-battery focus:outline-none"
          />
          {error && <p className="text-sm text-alert">{error}</p>}
          <button
            type="submit"
            disabled={submitting || !password}
            className="w-full rounded-lg bg-battery py-2.5 text-sm font-semibold text-black transition-all duration-150 hover:opacity-90 active:scale-95 disabled:opacity-50"
          >
            {submitting ? "Checking…" : "Unlock"}
          </button>
        </form>
      </div>
    </div>
  );
}
