import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "../../services/api";

interface PoiResult {
  id: number;
  category: string;
  name: string | null;
  latitude: number;
  longitude: number;
  opening_hours: string | null;
  fee: string | null;
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

  useEffect(() => {
    api.location
      .get()
      .then(setLocation)
      .catch(() => setError("No location set — configure one in Settings → General first."));
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
      .then(setPois)
      .catch(() => setError("Couldn't reach the POI search — check your connection."))
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
        L.marker([p.latitude, p.longitude], { icon: markerIcon(meta.color) })
          .bindPopup(
            `<strong>${p.name ?? meta.label}</strong><br/>${meta.label}${p.opening_hours ? `<br/>${p.opening_hours}` : ""}`
          )
          .addTo(layer);
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
              activeCategories.has(key) ? "bg-white/10 text-text-primary" : "bg-white/5 text-text-muted opacity-50"
            }`}
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.color }} />
            {meta.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-alert">{error}</p>}

      <div ref={mapContainerRef} className="h-[420px] w-full overflow-hidden rounded-xl2 border border-white/10" />

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
        <span>{loading ? "Searching nearby..." : `${pois.filter((p) => activeCategories.has(p.category)).length} places found within 10km`}</span>
        <a href="https://park4night.com/en" target="_blank" rel="noreferrer" className="text-solar hover:underline">
          Open Park4Night for reviews & photos →
        </a>
      </div>
    </div>
  );
}
