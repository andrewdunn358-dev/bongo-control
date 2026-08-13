import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CloudDownload, Loader2, CloudOff } from 'lucide-react';
import type maplibregl from 'maplibre-gl';
import { prefetchArea, type PrefetchProgress } from '@/lib/mapStyle';
import { MAPS } from '@/constants/testIds';
import { cn } from '@/lib/utils';

/**
 * "Save this area" - the button that makes a map usable with no signal.
 *
 * Sits over the map itself rather than in Settings, because the thing
 * being saved is *the view you are looking at*. Putting it anywhere else
 * would mean guessing which area the user meant.
 *
 * The honest bits, which matter more than the button:
 *  - It reports what it actually saved, including partial saves. A save
 *    that half-worked on one bar is the normal case out here.
 *  - It only claims tiles are missing when the device is genuinely
 *    offline. MapLibre fires errors for aborted requests during fast
 *    panning too, and crying "no map data" over a working connection
 *    would train you to ignore the warning that matters.
 */
export function MapOfflineControls({ map, className }: { map: maplibregl.Map | null; className?: string }) {
  const [progress, setProgress] = useState<PrefetchProgress | null>(null);
  const [missing, setMissing] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  useEffect(() => {
    if (!map) return;
    // Offline + a failed map request = this area genuinely isn't saved.
    const onError = () => {
      if (!navigator.onLine) setMissing(true);
    };
    // Re-evaluate per view: panning somewhere else is a different question.
    const onMove = () => setMissing(false);
    map.on('error', onError);
    map.on('moveend', onMove);
    return () => {
      map.off('error', onError);
      map.off('moveend', onMove);
    };
  }, [map]);

  // Don't leave a save running after the map unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const save = async () => {
    if (!map || progress) return;
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await prefetchArea(map, { signal: controller.signal, onProgress: setProgress });
      if (result.noSource) {
        toast.error("Couldn't read the map's tile source — try again once the map has finished loading.");
      } else if (result.aborted) {
        toast(`Stopped — ${result.done - result.failed} tiles saved.`);
      } else if (result.failed > 0) {
        toast.warning(
          `Saved ${result.done - result.failed} of ${result.total}. ${result.failed} didn't come down — worth another go on a better signal.`,
        );
      } else {
        toast.success(`Saved ${result.total} tiles. This view now works with no signal.`);
        setMissing(false);
      }
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  };

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className={cn('absolute left-3 top-3 z-10 flex flex-col items-start gap-2', className)}>
      <button
        type="button"
        data-testid={MAPS.saveArea}
        onClick={save}
        disabled={!map || !online || Boolean(progress)}
        title={
          online
            ? 'Download this view for use with no signal'
            : "You're offline — connect to save an area for later"
        }
        className="rounded-full px-3 py-1.5 text-xs font-medium bg-navy-900/80 backdrop-blur ring-1 ring-ink/15 text-ink-soft hover:bg-navy-900 disabled:opacity-40 inline-flex items-center gap-1.5"
      >
        {progress ? <Loader2 size={13} className="animate-spin" /> : <CloudDownload size={13} />}
        {progress ? `Saving ${pct}% (${progress.done}/${progress.total})` : 'Save this area'}
      </button>

      {missing && (
        <div
          data-testid={MAPS.missingTiles}
          className="max-w-[15rem] rounded-xl px-3 py-2 text-[11px] bg-navy-900/85 backdrop-blur ring-1 ring-amber-400/30 text-amber-200 inline-flex items-start gap-1.5"
        >
          <CloudOff size={12} className="mt-0.5 shrink-0" />
          <span>This area wasn't saved before you lost signal, so parts of the map are missing.</span>
        </div>
      )}
    </div>
  );
}
