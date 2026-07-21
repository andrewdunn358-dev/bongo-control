import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { APP } from '@/constants/testIds';

/**
 * PWA update banner — listens for a new service worker becoming
 * installed and offers a reload. Silent unless there's actually an update.
 */
export function UpdateBanner() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let cancelled = false;

    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg || cancelled) return;
      if (reg.waiting) setWaiting(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            setWaiting(nw);
          }
        });
      });
    }).catch(() => {});

    const onControllerChange = () => window.location.reload();
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  if (!waiting) return null;

  return (
    <div
      data-testid={APP.updateBanner}
      className="fixed bottom-24 md:bottom-6 right-4 md:right-6 z-50 animate-fade-in"
    >
      <div className="flex items-center gap-3 rounded-2xl px-4 py-3 bg-aurora-teal/15 ring-1 ring-inset ring-aurora-teal/40 backdrop-blur-md">
        <RefreshCw size={16} className="text-aurora-teal" />
        <span className="text-sm">A new version is available.</span>
        <button
          type="button"
          onClick={() => waiting.postMessage({ type: 'SKIP_WAITING' })}
          className="rounded-full px-3 py-1 text-xs bg-aurora-teal text-navy-900 font-semibold hover:brightness-110"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
