import { useEffect, useRef, useState } from "react";
import { Video } from "lucide-react";
import Card from "../components/Cards/Card";

// Auto-refreshing snapshot rather than a continuous multipart stream.
// Multipart/x-mixed-replace (the standard way to do continuous MJPEG
// in an <img> tag) has a genuinely long history of inconsistent
// support across browsers and platforms - it worked fine on desktop
// here, but not on mobile, and rather than chase which specific
// platform quirk was responsible, a plain image re-fetched on a timer
// has nothing left to go wrong: it's just an ordinary HTTP GET,
// repeated. Costs smoothness (a slideshow, not video) for
// guaranteed-everywhere reliability.
const SNAPSHOT_URL = "/api/camera/snapshot";
const REFRESH_INTERVAL_MS = 1500;

export default function Camera() {
  // Preload each new frame in a background Image() object and only
  // swap the visible <img>'s src once it's fully loaded - naively
  // updating a visible <img>'s src on a timer causes a flash-to-blank
  // every refresh while the new one downloads. Once preloaded, the
  // browser can serve the already-fetched bytes for the visible swap
  // with no second round-trip.
  const [displayUrl, setDisplayUrl] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    const tick = () => {
      const url = `${SNAPSHOT_URL}?t=${Date.now()}`;
      const img = new Image();
      img.onload = () => {
        if (!cancelledRef.current) setDisplayUrl(url);
      };
      img.src = url;
    };

    tick();
    const interval = setInterval(tick, REFRESH_INTERVAL_MS);
    return () => {
      cancelledRef.current = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <Card label="Camera" icon={<Video size={14} />}>
      <div className="space-y-3">
        <p className="text-sm text-text-secondary">Live from the van's webcam (updates every {REFRESH_INTERVAL_MS / 1000}s).</p>

        <div className="max-h-[60vh] overflow-hidden rounded-2xl border border-white/[0.08] bg-black">
          {displayUrl ? (
            <img src={displayUrl} alt="Live camera feed" className="max-h-[60vh] w-full object-contain" />
          ) : (
            <div className="flex aspect-video items-center justify-center text-sm text-text-muted">Connecting...</div>
          )}
        </div>
        <p className="text-xs text-text-muted">
          Blank or not loading? Check the webcam's plugged in and{" "}
          <span className="font-mono">docker compose logs backend</span> for the actual ffmpeg error.
        </p>
      </div>
    </Card>
  );
}
