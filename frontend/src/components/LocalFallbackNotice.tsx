import { useEffect, useState } from 'react';
import { SWITCH_COUNTDOWN_S, useLocalFallback } from '@/lib/localFallback';

/** Shown for a few seconds before the app moves itself to the van's local
 *  address, with a way to stay put. See lib/localFallback.ts. */
export function LocalFallbackNotice() {
  const { pending, goNow, stay } = useLocalFallback();
  const [left, setLeft] = useState(SWITCH_COUNTDOWN_S);

  useEffect(() => {
    if (!pending) return;
    setLeft(SWITCH_COUNTDOWN_S);
    const id = setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(id);
  }, [pending]);

  if (!pending) return null;
  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4"
    >
      <div className="max-w-sm rounded-2xl border border-white/15 bg-[#0f2942] p-6 text-center text-white shadow-2xl">
        <h2 className="text-lg font-semibold">Can't reach the van over the internet</h2>
        <p className="mt-2 text-sm text-white/80">
          Switching to its local connection in {left}s. This works when this device is on the van's WiFi.
        </p>
        <div className="mt-5 flex gap-3">
          <button type="button" onClick={stay} className="min-h-[48px] flex-1 rounded-xl border border-white/25 px-4">
            Stay here
          </button>
          <button type="button" onClick={goNow} className="min-h-[48px] flex-1 rounded-xl bg-cyan-500 px-4 font-semibold text-black">
            Switch now
          </button>
        </div>
      </div>
    </div>
  );
}
