import { Video } from "lucide-react";
import Card from "../components/Cards/Card";

// A plain <img> pointed at an MJPEG stream, served directly by our own
// backend (see app/services/camera_service.py) - deliberately NOT
// go2rtc/WebRTC here. That stack exists to solve "get video across a
// network and through browser codec negotiation" - this webcam is
// plugged directly into the same Pi the backend runs on, so there's no
// network hop to solve for. MJPEG-over-HTTP is just an ordinary
// streaming HTTP response (a live sequence of JPEG images), so it
// rides on exactly the same /api/ proxy every other endpoint already
// uses - no separate reverse-proxy config, no mixed-content concerns,
// works identically over plain HTTP and through the Cloudflare
// Tunnel's HTTPS with zero special-casing.
const STREAM_URL = "/api/camera/stream";

export default function Camera() {
  return (
    <Card label="Camera" icon={<Video size={14} />}>
      <div className="space-y-3">
        <p className="text-sm text-text-secondary">Live from the van's webcam.</p>

        <div className="max-h-[60vh] overflow-hidden rounded-2xl border border-white/[0.08] bg-black">
          {/* key forces the <img> to remount (and reconnect) if the
              stream URL ever changes - not currently needed since the
              URL is static, but cheap insurance against a stale
              connection if that changes later. */}
          <img key={STREAM_URL} src={STREAM_URL} alt="Live camera feed" className="max-h-[60vh] w-full object-contain" />
        </div>
        <p className="text-xs text-text-muted">
          Blank or not loading? Check the webcam's plugged in and{" "}
          <span className="font-mono">docker compose logs backend</span> for the actual ffmpeg error.
        </p>
      </div>
    </Card>
  );
}
