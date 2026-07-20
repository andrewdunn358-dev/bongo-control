import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "../../services/api";
import { useLocationContext } from "../../context/LocationContext";

interface PoiResult {
  id: number;
  category: string;
  name: string | null;
  latitude: number;
  longitude: number;
  opening_hours: string | null;
  fee: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
}

// Colors match the app's existing design tokens where a category has an
// obvious match (battery cyan, solar gold, alert red); water/supermarket
// get their own distinct colors since they don't map to an existing domain.
const CATEGORY_META: Record<string, { label: string; color: string }> = {
  campsite: { label: "Campsite", color: "#46d2c4" },
  caravan_site: { label: "Caravan site", color: "#2ba89c" },
  dump_station: { label: "Dump / Elsan point", color: "#f0a84e" },
  water: { label: "Water", color: "#4a9eea" },
  supermarket: { label: "Supermarket", color: "#c9cdd6" },
  fuel: { label: "Fuel", color: "#ff6b6a" },
};

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function directionsUrl(lat: number, lon: number): string {
  // A plain navigation deep link, not a Places API call - opens the
  // device's native Maps app on Android/iOS, or Google Maps on the web
  // otherwise. No API key needed, same category of "hand off to an
  // external app" as the existing Park4Night link.
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
}

function buildPopupHtml(p: PoiResult, categoryLabel: string): string {
  const title = escapeHtml(p.name ?? categoryLabel);
  const lines: string[] = [`<strong>${title}</strong>`, categoryLabel];

  if (p.address) lines.push(escapeHtml(p.address));
  if (p.opening_hours) lines.push(escapeHtml(p.opening_hours));
  if (p.fee) lines.push(`Fee: ${escapeHtml(p.fee)}`);
  if (p.phone) lines.push(`<a href="tel:${escapeHtml(p.phone)}">${escapeHtml(p.phone)}</a>`);
  if (p.website) {
    const href = /^https?:\/\//.test(p.website) ? p.website : `https://${p.website}`;
    lines.push(`<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">Website</a>`);
  }

  lines.push(
    `<a href="${directionsUrl(p.latitude, p.longitude)}" target="_blank" rel="noreferrer" style="color:#4a9eea">Get Directions</a>`
  );

  return lines.join("<br/>");
}

function markerIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #0a0e14;box-shadow:0 1px 3px rgba(0,0,0,0.5)"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

export default function NearbyMap() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);

  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [pois, setPois] = useState<PoiResult[]>([]);
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set(Object.keys(CATEGORY_META)));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);

  const { ensureFresh } = useLocationContext();

  useEffect(() => {
    // Refreshes GPS first if the stored location looks stale, then
    // reads whatever's current - fixes "I moved and it's still showing
    // where I was an hour ago" without a manual Settings tap every time.
    ensureFresh()
      .then(() => api.location.get())
      .then(setLocation)
      .catch(() => setError("No location set — configure one in Settings → General first."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mount the map once we have a location to center it on.
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !location) return;

    const map = L.map(mapContainerRef.current, { zoomControl: true }).setView([location.latitude, location.longitude], 12);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    L.marker([location.latitude, location.longitude], {
      icon: L.divIcon({
        className: "",
        html: `<div style="width:16px;height:16px;border-radius:50%;background:#f0a84e;border:3px solid #0a0e14;box-shadow:0 0 0 2px rgba(240,168,78,0.4)"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      }),
    })
      .addTo(map)
      .bindPopup("You are here");

    markersLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [location]);

  const loadPois = () => {
    if (!location) return;
    setLoading(true);
    setError(null);
    api.poi
      .nearby(10000, Object.keys(CATEGORY_META))
      .then((data) => {
        setPois(data.results);
        setFromCache(data.from_cache);
        setCachedAt(data.cached_at);
      })
      .catch(() => setError("No connection, and nothing saved for this area yet."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (location) loadPois();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  // Redraw markers whenever results or the active category filter changes.
  useEffect(() => {
    const layer = markersLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    pois
      .filter((p) => activeCategories.has(p.category))
      .forEach((p) => {
        const meta = CATEGORY_META[p.category];
        if (!meta) return;
        L.marker([p.latitude, p.longitude], { icon: markerIcon(meta.color) }).bindPopup(buildPopupHtml(p, meta.label)).addTo(layer);
      });
  }, [pois, activeCategories]);

  const toggleCategory = (category: string) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  if (error && !location) {
    return <p className="text-sm text-alert">{error}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {Object.entries(CATEGORY_META).map(([key, meta]) => (
          <button
            key={key}
            onClick={() => toggleCategory(key)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-all duration-150 ${
              activeCategories.has(key) ? "bg-ink/10 text-text-primary" : "bg-ink/5 text-text-muted opacity-50"
            }`}
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.color }} />
            {meta.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-alert">{error}</p>}

      <div ref={mapContainerRef} className="h-[420px] w-full overflow-hidden rounded-xl2 border border-ink/10" />

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
        <span>
          {loading
            ? "Searching nearby..."
            : `${pois.filter((p) => activeCategories.has(p.category)).length} places within 10km`}
          {!loading && fromCache && cachedAt && (
            <span className="text-solar"> · saved offline data from {new Date(cachedAt * 1000).toLocaleDateString()}</span>
          )}
        </span>
        <a href="https://park4night.com/en" target="_blank" rel="noreferrer" className="text-solar hover:underline">
          Open Park4Night for reviews & photos →
        </a>
      </div>
    </div>
  );
}
