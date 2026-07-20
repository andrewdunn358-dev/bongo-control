import { useEffect, useState } from "react";
import { Smartphone, CheckCircle2, MapPin, Navigation } from "lucide-react";
import Card from "../../components/Cards/Card";
import { useInstallPrompt } from "../../hooks/useInstallPrompt";
import { api } from "../../services/api";

interface LocationInfo {
  latitude: number;
  longitude: number;
  source: string;
  updated_at: number;
  city?: string;
  country?: string;
}

function LocationCard() {
  const [location, setLocation] = useState<LocationInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api.location
      .get()
      .then(setLocation)
      .catch(() => setLocation(null));
  };

  useEffect(load, []);

  const useGps = () => {
    setBusy(true);
    setError(null);
    if (!navigator.geolocation) {
      setError("This browser doesn't support location access.");
      setBusy(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          await api.location.setGps(position.coords.latitude, position.coords.longitude);
          load();
        } catch {
          setError("Got your location, but couldn't reach the backend to save it.");
        } finally {
          setBusy(false);
        }
      },
      (geoError) => {
        setError(geoError.code === geoError.PERMISSION_DENIED ? "Location permission denied." : "Couldn't get your location.");
        setBusy(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const useIpFallback = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.location.refreshIpFallback();
      load();
    } catch {
      setError("IP-based lookup failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card label="Location" icon={<MapPin size={14} />}>
      <div className="space-y-3">
        <p className="text-sm text-text-secondary">
          Used for weather and solar forecasting. Uses this device's GPS (most accurate) — an approximate,
          IP-based fallback is available if location access isn't granted.
        </p>

        {location && (
          <div className="rounded-lg bg-surface-raised px-3 py-2 text-sm">
            <div className="font-mono text-text-primary">
              {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
            </div>
            <div className="text-text-muted">
              {location.source === "gps" ? "From this device's GPS" : `Approximate (IP-based)${location.city ? ` — near ${location.city}` : ""}`} ·
              updated {new Date(location.updated_at * 1000).toLocaleString()}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-alert">{error}</p>}

        <div className="flex flex-wrap gap-2">
          <button
            onClick={useGps}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-solar px-4 py-2 text-sm font-semibold text-black transition-all duration-150 hover:opacity-90 active:scale-95 disabled:opacity-50"
          >
            <Navigation size={14} />
            {busy ? "Getting location..." : "Use My Location"}
          </button>
          <button
            onClick={useIpFallback}
            disabled={busy}
            className="rounded-lg bg-ink/10 px-4 py-2 text-sm text-text-primary transition-all duration-150 hover:bg-ink/15 active:scale-95 disabled:opacity-50"
          >
            Use Approximate (IP-based)
          </button>
        </div>
      </div>
    </Card>
  );
}

export default function General() {
  const { canInstall, installed, isIOS, promptInstall } = useInstallPrompt();

  return (
    <div className="space-y-4">
      <LocationCard />

      <Card label="Install App" icon={<Smartphone size={14} />} accent={installed ? "battery" : "neutral"}>
        {installed ? (
          <div className="flex items-center gap-2 text-sm text-text-primary">
            <CheckCircle2 size={16} className="text-battery" />
            Installed — running as an app
          </div>
        ) : canInstall ? (
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">
              Install for a full-screen, app-like experience — no browser bar, launches from your home screen.
            </p>
            <button
              onClick={promptInstall}
              className="rounded-lg bg-solar px-4 py-2 text-sm font-semibold text-black transition-all duration-150 hover:opacity-90 active:scale-95"
            >
              Install Bongo Control
            </button>
          </div>
        ) : isIOS ? (
          <p className="text-sm text-text-secondary">
            Tap the <span className="text-text-primary">Share</span> icon in Safari's toolbar, then{" "}
            <span className="text-text-primary">Add to Home Screen</span>. iOS doesn't support one-tap install from the page
            itself.
          </p>
        ) : (
          <p className="text-sm text-text-secondary">
            Look for an install icon in your browser's address bar, or use its menu → "Install Bongo Control" / "Add to Home
            Screen".
          </p>
        )}
      </Card>
    </div>
  );
}
