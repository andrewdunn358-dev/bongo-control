import { Video } from "lucide-react";
import Card from "../components/Cards/Card";

const STREAM_NAME = "cctv"; // must match the stream key in docker/go2rtc.yaml

// Same-origin relative path, proxied to go2rtc by nginx (see docker/nginx.conf).
// This is deliberate, not just tidiness: it's what avoids the
// mixed-content issue entirely (go2rtc has no TLS of its own, so an
// absolute http:// URL would get blocked on an https:// page), and
// it's what lets go2rtc's MSE fallback actually traverse the
// Cloudflare Tunnel - unlike raw WebRTC (peer-to-peer UDP), MSE is
// WebSocket-based, so a same-origin proxy carries it fine.
const STREAM_URL = `/camera/stream.html?src=${STREAM_NAME}`;

export default function Camera() {
  return (
    <Card label="Camera" icon={<Video size={14} />}>
      <div className="space-y-3">
        <p className="text-sm text-text-secondary">
          Live from the van's CCTV camera. On the van's own WiFi this connects directly (low latency); accessed
          remotely it falls back to a slightly-delayed stream automatically - both go through the same address.
        </p>

        <div className="max-h-[60vh] overflow-hidden rounded-2xl border border-white/[0.08] bg-black">
          <iframe src={STREAM_URL} title="CCTV camera live view" className="aspect-video max-h-[60vh] w-full" allow="autoplay" />
        </div>
        <p className="text-xs text-text-muted">
          Blank or not loading? Check the camera's powered on, and that the camera relay is running (it's a separate
          Docker service - <span className="font-mono">docker compose ps</span> should show go2rtc as Up).
        </p>
      </div>
    </Card>
  );
}
