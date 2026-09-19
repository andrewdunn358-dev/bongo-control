import { useEffect, useState } from 'react';
import { MOVE_COUNTDOWN_S, useConnection } from '@/lib/connection';

/** Shown for a few seconds before the app moves between its local and
 *  remote connection, with a way to stay put. See lib/connection.ts. */
export function ConnectionNotice() {
  const { pending, goNow, stay } = useConnection();
  const [left, setLeft] = useState(MOVE_COUNTDOWN_S);

  useEffect(() => {
    if (!pending) return;
    setLeft(MOVE_COUNTDOWN_S);
    const id = setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(id);
  }, [pending]);

  if (!pending) return null;
  const title = pending.to === 'local' ? 'Switching to LOCAL — Direct to VanOS Pi' : 'Switching to REMOTE — via the internet';
  return (
    <div role="alertdialog" aria-live="assertive" className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4">
      <div className="max-w-sm rounded-2xl border border-white/15 bg-[#0f2942] p-6 text-center text-white shadow-2xl">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-white/80">{pending.reason}</p>
        <p className="mt-1 text-sm text-white/60">In {left}s.</p>
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
