import { Video, AlertTriangle } from "lucide-react";
import Card from "../components/Cards/Card";

const GO2RTC_PORT = 1984;
const STREAM_NAME = "cctv"; // must match the stream key in docker/go2rtc.yaml

export default function Camera() {
  // go2rtc has no TLS configured (not worth the complexity for a
  // local-only feature) - an http:// iframe inside this https:// page
  // would be silently blocked by the browser's mixed-content policy.
  // Detecting this directly rather than showing a mysterious blank box.
  const isSecureContext = window.location.protocol === "https:";

  if (isSecureContext) {
    return (
      <Card label="Camera" icon={<Video size={14} />} accent="alert">
        <div className="flex items-start gap-3">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-alert" />
          <div>
            <p className="text-sm text-text-primary">Camera view needs the local address, not the HTTPS one.</p>
            <p className="mt-1 text-sm text-text-secondary">
              This page was loaded securely (HTTPS), but the camera relay only serves plain HTTP - browsers block
              that combination. While on the van's own WiFi, open the dashboard's local address instead (the Pi's IP
              or hostname, e.g. <span className="font-mono text-text-primary">http://192.168.x.x:8090</span>) to view
              the camera.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const streamUrl = `http://${window.location.hostname}:${GO2RTC_PORT}/stream.html?src=${STREAM_NAME}`;

  return (
    <Card label="Camera" icon={<Video size={14} />}>
      <div className="space-y-3">
        <p className="text-sm text-text-secondary">
          Live from the van's CCTV camera. Only works on the van's own WiFi - this is a direct local connection, not
          something that can be tunneled remotely.
        </p>

        <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-black">
          <iframe src={streamUrl} title="CCTV camera live view" className="aspect-video w-full" allow="autoplay" />
        </div>
        <p className="text-xs text-text-muted">
          Blank or not loading? Check the camera's powered on and on the same WiFi, and that the camera relay is
          running (it's a separate Docker service - <span className="font-mono">docker compose ps</span> should show
          go2rtc as Up).
        </p>
      </div>
    </Card>
  );
}
