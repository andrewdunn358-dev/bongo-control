import { useRegisterSW } from "virtual:pwa-register/react";
import { RefreshCw } from "lucide-react";

/**
 * With registerType: "autoUpdate", a new version downloads and
 * activates silently in the background - the currently open tab (or
 * an already-installed PWA that never gets fully closed) just keeps
 * showing the old one, with no indication anything changed. This is
 * exactly what caused confusion after each of the last several
 * deployments: "is it updated or not?" with no way to tell short of
 * force-closing and reopening a few times and hoping.
 *
 * useRegisterSW's needRefresh flag flips true the moment a new service
 * worker has installed and is waiting to take over - this surfaces
 * that moment directly instead of leaving it invisible.
 */
export default function UpdateBanner() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Check for an update whenever the tab becomes visible again -
      // covers the common case of leaving the dashboard open for hours
      // and coming back to it, rather than only checking on cold load.
      if (!registration) return;
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          registration.update();
        }
      });
    },
  });

  if (!needRefresh) return null;

  return (
    <div className="fixed inset-x-4 top-4 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-battery/25 bg-surface-card/95 p-4 shadow-[0_16px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-battery/15">
        <RefreshCw size={16} className="text-battery" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-ink">Update available</div>
        <div className="text-xs text-ink/50">A new version is ready to install.</div>
      </div>
      <button
        onClick={() => updateServiceWorker(true)}
        className="shrink-0 rounded-lg bg-battery px-3 py-2 text-xs font-semibold text-black transition-all duration-150 hover:opacity-90 active:scale-95"
      >
        Refresh
      </button>
    </div>
  );
}
