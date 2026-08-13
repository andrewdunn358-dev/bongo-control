import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import maplibregl from 'maplibre-gl';
import { Droplet, Trash2, ShoppingCart, Fuel, TentTree, Caravan, Sparkles, RefreshCw, Info, Navigation, ExternalLink, Compass, SignalHigh, SignalLow, SignalZero, AlertTriangle, Loader2 } from 'lucide-react';
import { GlassCard, CardHeader } from '@/components/primitives/GlassCard';
import { StatusPill } from '@/components/primitives/StatusPill';
import { api } from '@/lib/api';
import { isDemo } from '@/lib/demo';
import { loadGoogleMaps } from '@/lib/googleMaps';
import { fmtDistance, DASH } from '@/lib/format';
import { readStored, writeStored } from '@/lib/theme';
import { NEARBY } from '@/constants/testIds';
import { cn } from '@/lib/utils';
import { SPOT_PROVIDERS, park4nightUrl } from '@/lib/deeplinks';
import type { PoiItem, CoverageResult, CoverageStatus } from '@/lib/types';

/**
 * One coverage lookup, reduced to what a map pin needs. Built from
 * either /coverage/here (the van's current spot — this is how "type a
 * postcode" turns into "just tap Signal": the backend already resolves
 * the van's GPS fix to a postcode server-side, see coverage_service.py)
 * or /coverage/recent (places already checked, so the pins persist
 * across visits without spending quota again).
 */
interface CoveragePin {
  key: string;
  latitude: number;
  longitude: number;
  label: string;
  ratingLabel: 'none' | 'limited' | 'likely' | 'unknown';
  result: CoverageResult;
  isHere: boolean;
}

// Same three-state palette as the Coverage page (Coverage.tsx) — no
// bars-out-of-five here either, for the same honesty reason.
const COVERAGE_PIN_COLOUR: Record<string, string> = {
  likely: '#22c55e',
  limited: '#fbbf24',
  none: '#f87171',
  unknown: '#64748b',
};
const COVERAGE_ICON: Record<string, typeof SignalHigh> = {
  likely: SignalHigh,
  limited: SignalLow,
  none: SignalZero,
  unknown: SignalZero,
};

/** Pulls the home network's outdoor 4G rating out of a CoverageResult —
 *  the single number a pin needs, out of the four-operator breakdown. */
function homeRating(result: CoverageResult | undefined, homeNetworkKey: string | undefined): CoveragePin['ratingLabel'] {
  const op = result?.operators.find((o) => o.key === homeNetworkKey) ?? result?.operators[0];
  return (op?.data_outdoor.label as CoveragePin['ratingLabel']) ?? 'unknown';
}

/**
 * Distance from the van to a POI, in metres.
 *
 * The backend deliberately doesn't send a precomputed distance - POI
 * results are cached for 7 days and served offline, so a distance
 * baked in at fetch time would be wrong the moment the van moves.
 * Computing it here against the current location keeps it correct.
 */
function distanceMetres(fromLat: number, fromLon: number, toLat: number, toLon: number): number {
  const R = 6371000;
  const p1 = (fromLat * Math.PI) / 180;
  const p2 = (toLat * Math.PI) / 180;
  const dp = ((toLat - fromLat) * Math.PI) / 180;
  const dl = ((toLon - fromLon) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Secondary line for a POI - the backend sends real OSM detail
 *  (address, opening hours, fee) rather than a generic "note". Shows
 *  whichever is actually present, since many entries have none. */
function poiDetail(p: PoiItem): string | null {
  return p.address || p.opening_hours || (p.fee ? `Fee: ${p.fee}` : null);
}


// Keyed by the EXACT category values the backend emits (see
// poi_service.py POI_TAGS). These MUST stay in sync — a key that doesn't
// match a backend category means that POI falls back to the water icon
// and the corresponding filter silently returns everything.
const CATEGORY_META: Record<string, { Icon: typeof Droplet; color: string; label: string }> = {
  water:        { Icon: Droplet,      color: '#22d3ee', label: 'Water' },
  dump_station: { Icon: Trash2,       color: '#a3e635', label: 'Dump' },
  supermarket:  { Icon: ShoppingCart, color: '#f472b6', label: 'Shops' },
  fuel:         { Icon: Fuel,         color: '#f59e0b', label: 'Fuel' },
  campsite:     { Icon: TentTree,     color: '#a855f7', label: 'Camping' },
  caravan_site: { Icon: Caravan,      color: '#c084fc', label: 'Caravan' },
};

// Filter chips. Each maps to one or more backend categories; `cats` is
// what gets sent to /api/poi/nearby (undefined = all). "Camping" covers
// both campsite and caravan_site so a single chip finds either.
//
// "Signal" is not a POI category — it has no `cats`, so selecting it
// still shows every POI underneath (undefined = all, same as "All").
// It additionally switches on the coverage pin overlay, fetched only
// while this chip is selected (see the coverage queries in Nearby()) —
// deliberately lazy, since each lookup spends Ofcom's metered quota.
const FILTERS: { key: string; label: string; cats?: string[] }[] = [
  { key: 'all',     label: 'All' },
  { key: 'water',   label: 'Water',   cats: ['water'] },
  { key: 'dump',    label: 'Dump',    cats: ['dump_station'] },
  { key: 'camping', label: 'Camping', cats: ['campsite', 'caravan_site'] },
  { key: 'fuel',    label: 'Fuel',    cats: ['fuel'] },
  { key: 'shops',   label: 'Shops',   cats: ['supermarket'] },
  { key: 'signal',  label: 'Signal' },
];

const MAPLIBRE_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const FILTER_KEY = 'bongo.nearby.filter';
// Default map centre when no location fix exists yet: central UK (this
// is a UK van), not the library-default Portland, Oregon.
const DEFAULT_CENTRE: [number, number] = [-2.0, 54.0];

type LocLike = { latitude?: number | null; longitude?: number | null } | undefined;

/** Google Maps rendering of the van + POI markers. */
function GoogleNearbyMap({
  loc,
  poiResults,
  onSelect,
  apiKey,
  coveragePins,
  onSelectCoverage,
  signalMode,
  onScanArea,
}: {
  loc: LocLike;
  poiResults: PoiItem[];
  onSelect: (p: PoiItem) => void;
  apiKey: string;
  coveragePins: CoveragePin[];
  onSelectCoverage: (p: CoveragePin) => void;
  signalMode: boolean;
  onScanArea: (centre: { lat: number; lon: number }) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const vanMarkerRef = useRef<google.maps.Marker | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const coverageMarkersRef = useRef<google.maps.Marker[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mapType, setMapType] = useState<'roadmap' | 'hybrid'>('roadmap');
  // The map loads asynchronously (external script + init), but setting
  // mapRef.current alone doesn't trigger a re-render - so without this,
  // a marker-drawing effect that happened to run (and bail out early)
  // *before* the map was ready would never run again unless loc/POIs
  // changed again afterward. For a parked van with a stable GPS fix,
  // they often don't - which is exactly why the van pin was going
  // missing while POI pins (which do change, on filter clicks) still
  // showed up fine.
  const [mapReady, setMapReady] = useState(false);
  // Auto-follow the van's GPS fix until the person manually drags the
  // map - then stop, so panning around to use Signal's "Scan this
  // area" (or just browsing POIs elsewhere) doesn't get yanked back to
  // the van on the next location poll. 'dragstart' only fires for a
  // real user drag, never for the panTo/setZoom calls below, so this
  // can't misfire on our own programmatic moves.
  const [followingVan, setFollowingVan] = useState(true);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps(apiKey)
      .then((g) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        const center = loc?.latitude != null && loc?.longitude != null
          ? { lat: loc.latitude, lng: loc.longitude }
          : { lat: DEFAULT_CENTRE[1], lng: DEFAULT_CENTRE[0] };
        mapRef.current = new g.maps.Map(containerRef.current, {
          center,
          zoom: 12.5,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
        });
        mapRef.current.addListener('dragstart', () => setFollowingVan(false));
        setMapReady(true);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load Google Maps'));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  // Map/Satellite toggle - custom pill rather than Google's own
  // mapTypeControl chrome, to match the app's look.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.google?.maps) return;
    map.setMapTypeId(mapType === 'hybrid' ? window.google.maps.MapTypeId.HYBRID : window.google.maps.MapTypeId.ROADMAP);
  }, [mapReady, mapType]);

  // Re-centre when the backend's location fix changes - only while
  // still "following". A manual drag (see dragstart above) turns this
  // off until the person taps "Follow van" again.
  useEffect(() => {
    const map = mapRef.current;
    if (map && followingVan && loc?.latitude != null && loc?.longitude != null) {
      map.panTo({ lat: loc.latitude, lng: loc.longitude });
      map.setZoom(12.8);
    }
  }, [mapReady, followingVan, loc?.latitude, loc?.longitude]);

  // Van + POI markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.google?.maps) return;
    const g = window.google;

    vanMarkerRef.current?.setMap(null);
    vanMarkerRef.current = null;
    if (loc?.latitude != null && loc?.longitude != null) {
      vanMarkerRef.current = new g.maps.Marker({
        position: { lat: loc.latitude, lng: loc.longitude },
        map,
        icon: { path: g.maps.SymbolPath.CIRCLE, scale: 9, fillColor: '#22d3ee', fillOpacity: 1, strokeColor: '#0a1628', strokeWeight: 3 },
        zIndex: 999,
        title: 'Van',
      });
    }

    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = poiResults.map((p) => {
      const marker = new g.maps.Marker({
        position: { lat: p.latitude, lng: p.longitude },
        map,
        icon: {
          url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(googleMarkerSvg(p.category))}`,
          scaledSize: new g.maps.Size(30, 30),
          anchor: new g.maps.Point(15, 15),
        },
      });
      marker.addListener('click', () => onSelect(p));
      return marker;
    });
  }, [mapReady, poiResults, loc?.latitude, loc?.longitude, onSelect]);

  // Coverage pins — the van's current lookup plus any recently-checked
  // spots. A ring (not a fill colour swap) marks "here" so it reads
  // distinctly from the ordinary cached pins at a glance.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.google?.maps) return;
    const g = window.google;
    coverageMarkersRef.current.forEach((m) => m.setMap(null));
    coverageMarkersRef.current = coveragePins.map((pin) => {
      const colour = COVERAGE_PIN_COLOUR[pin.ratingLabel];
      const marker = new g.maps.Marker({
        position: { lat: pin.latitude, lng: pin.longitude },
        map,
        icon: {
          url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(coverageMarkerSvg(colour, pin.isHere))}`,
          scaledSize: new g.maps.Size(pin.isHere ? 36 : 26, pin.isHere ? 36 : 26),
          anchor: new g.maps.Point(pin.isHere ? 18 : 13, pin.isHere ? 18 : 13),
        },
        zIndex: pin.isHere ? 998 : undefined,
        title: `${pin.label} — ${pin.ratingLabel}`,
      });
      marker.addListener('click', () => onSelectCoverage(pin));
      return marker;
    });
  }, [mapReady, coveragePins, onSelectCoverage]);

  if (error) {
    return (
      <div className="h-[440px] sm:h-[520px] lg:h-[640px] w-full grid place-items-center text-sm text-status-amber px-6 text-center">
        {error} — check the API key in Settings → Integrations.
      </div>
    );
  }
  return (
    <div className="relative h-[440px] sm:h-[520px] lg:h-[640px] w-full">
      {/* Same fix as Trips' GoogleTripsMap - see that component's comment
          for the reported symptom (a black flash before the map appears)
          and why: Google's map script genuinely takes a moment to load,
          and this container previously rendered bare during that gap. */}
      {!mapReady && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-navy-900 rounded-2xl">
          <div className="flex flex-col items-center gap-2 text-ink-muted">
            <Loader2 size={22} className="animate-spin text-aurora-teal" />
            <span className="text-xs">Loading map…</span>
          </div>
        </div>
      )}
      <div ref={containerRef} data-testid={NEARBY.map} className="w-full h-full" />
      <div className="absolute top-3 left-3 z-10 flex rounded-full overflow-hidden ring-1 ring-black/20 shadow-lg text-xs font-medium">
        <button
          type="button"
          onClick={() => setMapType('roadmap')}
          className={mapType === 'roadmap' ? 'px-3 py-1.5 bg-navy-900 text-white' : 'px-3 py-1.5 bg-white text-navy-900'}
        >
          Map
        </button>
        <button
          type="button"
          onClick={() => setMapType('hybrid')}
          className={mapType === 'hybrid' ? 'px-3 py-1.5 bg-navy-900 text-white' : 'px-3 py-1.5 bg-white text-navy-900'}
        >
          Satellite
        </button>
      </div>
      {!followingVan && (
        <button
          type="button"
          onClick={() => setFollowingVan(true)}
          className="absolute bottom-3 left-3 z-10 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium bg-navy-900/90 text-white ring-1 ring-white/15 shadow-lg hover:bg-navy-900"
        >
          <Navigation size={13} /> Follow van
        </button>
      )}
      {signalMode && (
        <button
          type="button"
          onClick={() => {
            const c = mapRef.current?.getCenter();
            if (c) onScanArea({ lat: c.lat(), lon: c.lng() });
          }}
          className="absolute top-3 right-3 z-10 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium bg-navy-900/90 text-white ring-1 ring-white/15 shadow-lg hover:bg-navy-900"
        >
          <SignalHigh size={13} /> Scan this area
        </button>
      )}
    </div>
  );
}

/** MapLibre/OSM rendering of the van + POI markers — the default when
 * no Google Maps key is configured, and always used in the browser demo. */
function MapLibreNearbyMap({
  loc,
  poiResults,
  onSelect,
  coveragePins,
  onSelectCoverage,
  signalMode,
  onScanArea,
}: {
  loc: LocLike;
  poiResults: PoiItem[];
  onSelect: (p: PoiItem) => void;
  coveragePins: CoveragePin[];
  onSelectCoverage: (p: CoveragePin) => void;
  signalMode: boolean;
  onScanArea: (centre: { lat: number; lon: number }) => void;
}) {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const coverageMarkersRef = useRef<maplibregl.Marker[]>([]);
  // Same auto-follow-until-dragged behaviour as GoogleNearbyMap - see
  // there for the full reasoning.
  const [followingVan, setFollowingVan] = useState(true);

  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return;
    const center: [number, number] = loc?.longitude != null && loc?.latitude != null
      ? [loc.longitude, loc.latitude]
      : DEFAULT_CENTRE;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAPLIBRE_STYLE,
      center,
      zoom: 12.5,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
    map.on('dragstart', () => setFollowingVan(false));
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mapRef.current && followingVan && loc?.latitude != null && loc?.longitude != null) {
      mapRef.current.flyTo({ center: [loc.longitude, loc.latitude], zoom: 12.8, essential: true });
    }
  }, [followingVan, loc?.latitude, loc?.longitude]);

  useEffect(() => {
    if (!mapRef.current) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (loc?.latitude != null && loc?.longitude != null) {
      const van = document.createElement('div');
      van.style.cssText = 'width:22px;height:22px;border-radius:9999px;background:radial-gradient(circle,#22d3ee 0%,rgba(34,211,238,0.15) 70%,transparent 100%);box-shadow:0 0 22px rgba(34,211,238,0.6);position:relative';
      van.innerHTML = '<div style="position:absolute;inset:6px;background:#22d3ee;border-radius:9999px"></div>';
      const m = new maplibregl.Marker({ element: van }).setLngLat([loc.longitude, loc.latitude]).addTo(mapRef.current);
      markersRef.current.push(m);
    }

    poiResults.forEach((p) => {
      const meta = CATEGORY_META[p.category] || CATEGORY_META.water;
      const el = document.createElement('div');
      el.style.cursor = 'pointer';
      el.style.cssText = `width:34px;height:34px;border-radius:12px;display:grid;place-items:center;background:rgba(15,41,66,0.92);box-shadow:0 0 0 1px ${meta.color}55, 0 0 18px ${meta.color}55;color:${meta.color};`;
      el.innerHTML = svgFor(p.category);
      el.onclick = () => onSelect(p);
      const m = new maplibregl.Marker({ element: el }).setLngLat([p.longitude, p.latitude]).addTo(mapRef.current!);
      markersRef.current.push(m);
    });
  }, [poiResults, loc?.latitude, loc?.longitude, onSelect]);

  // Coverage pins — plain dot in the rating colour, "here" gets a ring.
  // Same treatment as the Google map so the two renderers agree.
  useEffect(() => {
    if (!mapRef.current) return;
    coverageMarkersRef.current.forEach((m) => m.remove());
    coverageMarkersRef.current = coveragePins.map((pin) => {
      const colour = COVERAGE_PIN_COLOUR[pin.ratingLabel];
      const size = pin.isHere ? 30 : 20;
      const el = document.createElement('div');
      el.style.cursor = 'pointer';
      el.style.cssText = `width:${size}px;height:${size}px;border-radius:9999px;background:${colour};box-shadow:0 0 0 2px #0f2942${pin.isHere ? `, 0 0 0 5px ${colour}88` : ''};`;
      el.onclick = () => onSelectCoverage(pin);
      const m = new maplibregl.Marker({ element: el }).setLngLat([pin.longitude, pin.latitude]).addTo(mapRef.current!);
      return m;
    });
  }, [coveragePins, onSelectCoverage]);

  return (
    <div className="relative h-[440px] sm:h-[520px] lg:h-[640px] w-full">
      <div ref={mapContainerRef} data-testid={NEARBY.map} className="w-full h-full" />
      {!followingVan && (
        <button
          type="button"
          onClick={() => setFollowingVan(true)}
          className="absolute bottom-3 left-3 z-10 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium bg-navy-900/90 text-white ring-1 ring-white/15 shadow-lg hover:bg-navy-900"
        >
          <Navigation size={13} /> Follow van
        </button>
      )}
      {signalMode && (
        <button
          type="button"
          onClick={() => {
            const c = mapRef.current?.getCenter();
            if (c) onScanArea({ lat: c.lat, lon: c.lng });
          }}
          className="absolute top-3 right-14 z-10 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium bg-navy-900/90 text-white ring-1 ring-white/15 shadow-lg hover:bg-navy-900"
        >
          <SignalHigh size={13} /> Scan this area
        </button>
      )}
    </div>
  );
}

export function Nearby() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>(() => readStored<string>(FILTER_KEY, 'all'));
  const [selected, setSelected] = useState<PoiItem | null>(null);
  const [selectedCoverage, setSelectedCoverage] = useState<CoveragePin | null>(null);
  const [areaCenter, setAreaCenter] = useState<{ lat: number; lon: number } | null>(null);
  const showSignal = filter === 'signal';

  // Only one popup on screen at a time — selecting one kind clears the other.
  const handleSelectPoi = useCallback((p: PoiItem) => { setSelectedCoverage(null); setSelected(p); }, []);
  const handleSelectCoverage = useCallback((p: CoveragePin) => { setSelected(null); setSelectedCoverage(p); }, []);

  useEffect(() => { writeStored(FILTER_KEY, filter); }, [filter]);

  // Backend owns location — we just ask, and re-ask on a timer so the map
  // tracks live from whatever feeds the backend (GPS plugin, phone, manual)
  // without needing to leave and come back. Over the van's http origin the
  // browser can't do GPS itself, so polling the backend is how the map
  // stays current.
  const { data: loc, error: locError } = useQuery({
    queryKey: ['location'],
    queryFn: api.location,
    retry: 1,
    refetchInterval: 20000,
    refetchIntervalInBackground: false,
  });

  const poiParams = { categories: FILTERS.find((f) => f.key === filter)?.cats };
  const { data: poi, error: poiError, isFetching } = useQuery({
    queryKey: ['poi-nearby', filter],
    queryFn: () => api.poiNearby(poiParams),
    retry: 1,
  });

  // The plain refetch() above just re-runs the same request, which the
  // backend answers from its (up to 7-day) cache whenever the area's
  // already been fetched - meaning the Refresh button could never
  // actually do anything within that window, however many times you
  // tapped it. This bypasses the cache for real.
  const forceRefresh = useMutation({
    mutationFn: () => api.poiNearby({ ...poiParams, forceRefresh: true }),
    onSuccess: (data) => {
      qc.setQueryData(['poi-nearby', filter], data);
      toast.success(data.from_cache ? 'Still offline — kept the cached copy' : 'Refreshed with live data');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Refresh failed'),
  });

  const { data: aiStatus } = useQuery({ queryKey: ['ai-status'], queryFn: api.aiStatus });

  const { data: coverageStatus } = useQuery({ queryKey: ['coverage-status'], queryFn: api.coverageStatus });

  // Lazy on purpose, like the AI card above — Ofcom's API is a metered
  // quota, so this only fires while the Signal chip is actually
  // selected, not on every Nearby visit. The location fix already
  // being polled above is what lets this be a single tap instead of
  // typing a postcode: the backend resolves the van's current GPS fix
  // to a postcode itself (coverage_service.py), so there's nothing to
  // hand it here beyond "check now".
  const { data: coverageHere, error: coverageHereError, isFetching: coverageHereFetching } = useQuery({
    queryKey: ['coverage-here'],
    queryFn: api.coverageHere,
    enabled: showSignal,
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });

  const { data: coverageRecentData } = useQuery({
    queryKey: ['coverage-recent'],
    queryFn: () => api.coverageRecent(20),
    enabled: showSignal,
    staleTime: 60 * 1000,
  });

  // "Scan this area" — coverage for wherever the map is centred, not
  // just the van's own spot. Explicit tap only (areaCenter starts
  // null), same reasoning as the lazy queries above: each new postcode
  // in range spends a real Ofcom call, so this shouldn't fire from a
  // pan or a re-render, only a deliberate button press.
  const { data: coverageAreaData, isFetching: areaFetching, error: areaError } = useQuery({
    queryKey: ['coverage-area', areaCenter?.lat, areaCenter?.lon],
    queryFn: () => api.coverageArea(areaCenter!.lat, areaCenter!.lon),
    enabled: showSignal && !!areaCenter,
    staleTime: 5 * 60 * 1000,
  });

  // Van's current spot + everywhere else already checked + the last
  // area scan, all as pins. Not a blurred heatmap — Ofcom's prediction
  // only exists per postcode (no tile layer at any zoom), so a smoothed
  // gradient between sample points would invent confidence that isn't
  // there. A dense grid of real, individually-rated points is the
  // honest version of "looks like a heatmap at a glance" — see
  // coverage_service.area() for the full reasoning, including why this
  // sidesteps Google's own heatmap layer (deprecated, gone as of May 2026).
  const coveragePins = useMemo<CoveragePin[]>(() => {
    if (!showSignal) return [];
    const homeKey = coverageStatus?.home_network;
    const pins: CoveragePin[] = [];
    const seenPostcodes = new Set<string>();
    if (coverageHere && loc?.latitude != null && loc?.longitude != null) {
      pins.push({
        key: 'here',
        latitude: loc.latitude,
        longitude: loc.longitude,
        label: coverageHere.place?.label || coverageHere.postcode || 'Here',
        ratingLabel: homeRating(coverageHere, homeKey),
        result: coverageHere,
        isHere: true,
      });
      seenPostcodes.add(coverageHere.postcode);
    }
    (coverageRecentData?.results ?? []).forEach((r, i) => {
      if (r.place?.latitude == null || r.place?.longitude == null) return;
      if (seenPostcodes.has(r.postcode)) return;
      seenPostcodes.add(r.postcode);
      pins.push({
        key: `recent-${i}`,
        latitude: r.place.latitude,
        longitude: r.place.longitude,
        label: r.place?.label || r.postcode,
        ratingLabel: homeRating(r, homeKey),
        result: r,
        isHere: false,
      });
    });
    (coverageAreaData?.results ?? []).forEach((r, i) => {
      if (r.place?.latitude == null || r.place?.longitude == null) return;
      if (seenPostcodes.has(r.postcode)) return;
      seenPostcodes.add(r.postcode);
      pins.push({
        key: `area-${i}`,
        latitude: r.place.latitude,
        longitude: r.place.longitude,
        label: r.place?.label || r.postcode,
        ratingLabel: homeRating(r, homeKey),
        result: r,
        isHere: false,
      });
    });
    return pins;
  }, [showSignal, coverageHere, coverageRecentData, coverageAreaData, coverageStatus, loc?.latitude, loc?.longitude]);

  // Same key + same "always MapLibre in the demo" rule as Trips.tsx — see
  // that file for why. Sharing the ['config-general'] query key means
  // this doesn't refetch separately if Settings or Trips already has it.
  const cfg = useQuery({ queryKey: ['config-general'], queryFn: () => api.getConfig('general'), enabled: !isDemo });
  const mapsApiKey = String(cfg.data?.google_maps_api_key ?? '').trim();
  const useGoogle = !isDemo && mapsApiKey.length > 0;

  const filtered = useMemo(() => poi?.results ?? [], [poi]);

  return (
    <div data-testid={NEARBY.root} className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-10 py-6 lg:py-10">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-ink-muted">Nearby</div>
          <h1 className="text-3xl md:text-5xl font-semibold tracking-tight mt-1">What&apos;s <span className="text-aurora-teal">within reach</span>?</h1>
          <div className="text-sm text-ink-muted mt-2">Dump · water · food · fuel · camp spots · 4G signal · offline cached for 7 days.</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusPill tone={poi?.from_cache ? 'amber' : 'teal'} data-testid={NEARBY.offlineBadge}>
            {poi?.from_cache ? `OFFLINE · ${poi.cached_at ? new Date(poi.cached_at * 1000).toLocaleDateString() : 'cached'}` : 'LIVE'}
          </StatusPill>
          <button
            type="button"
            data-testid={NEARBY.refresh}
            onClick={() => forceRefresh.mutate()}
            disabled={forceRefresh.isPending}
            className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm bg-ink/[0.04] ring-1 ring-ink/10 text-ink-soft hover:bg-ink/[0.08] disabled:opacity-50"
          >
            <RefreshCw size={14} className={isFetching || forceRefresh.isPending ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4 lg:gap-6">
        <GlassCard className="col-span-12 lg:col-span-8 p-0 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-ink/5">
            <div className="flex items-center gap-2">
              <CardHeader label="Dark map" className="mb-0" hint={loc?.latitude ? `${loc.latitude?.toFixed(3)}, ${loc.longitude?.toFixed(3)}` : 'location loading'} />
              {/* Honesty label, not decoration — this is the same fix
                  applied everywhere else in the app (predicted coverage,
                  "no shunt installed"): an approximate reading must never
                  look as confident as a real one. Reported case: showed a
                  specific-looking coordinate for North Shields while
                  genuinely parked at Fontburn, many miles away, with
                  nothing on screen indicating it was an IP-based guess
                  rather than an actual GPS fix - this is what makes that
                  visible next time instead of silently misleading. */}
              {loc?.source === 'ip_approximate' && (
                <span
                  title="No GPS fix available - this is a rough guess from the Pi's internet connection, sometimes many miles off"
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/30"
                >
                  <AlertTriangle size={10} /> Approximate — no GPS fix
                </span>
              )}
              {loc?.source === 'gps' && (
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-status-green/15 text-status-green ring-1 ring-status-green/30">
                  GPS
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  data-testid={NEARBY.filter(f.key)}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    'text-xs px-3 py-1.5 rounded-full transition',
                    filter === f.key ? 'bg-aurora-teal/15 text-aurora-teal ring-1 ring-inset ring-aurora-teal/40' : 'text-ink-muted hover:text-ink hover:bg-ink/5',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          {useGoogle ? (
            <GoogleNearbyMap
              loc={loc}
              poiResults={filtered}
              onSelect={handleSelectPoi}
              apiKey={mapsApiKey}
              coveragePins={coveragePins}
              onSelectCoverage={handleSelectCoverage}
              signalMode={showSignal}
              onScanArea={setAreaCenter}
            />
          ) : (
            <MapLibreNearbyMap
              loc={loc}
              poiResults={filtered}
              onSelect={handleSelectPoi}
              coveragePins={coveragePins}
              onSelectCoverage={handleSelectCoverage}
              signalMode={showSignal}
              onScanArea={setAreaCenter}
            />
          )}
        </GlassCard>

        <div className="col-span-12 lg:col-span-4 space-y-4 lg:space-y-6">
          {showSignal && (
            <SignalCard
              status={coverageStatus}
              here={coverageHere}
              hereError={coverageHereError}
              hereFetching={coverageHereFetching}
              recent={coverageRecentData?.results ?? []}
              onSelectRecent={handleSelectCoverage}
              areaCount={coverageAreaData?.results.length}
              areaFetching={areaFetching}
              areaError={areaError}
            />
          )}
          <AiCard configured={aiStatus?.configured ?? false} />
          <SpotCard lat={loc?.latitude ?? null} lng={loc?.longitude ?? null} />
          <GlassCard className="p-4" data-testid={NEARBY.list}>
            <CardHeader label="All nearby" hint={`${filtered.length} places`} />
            <ul className="space-y-2 max-h-[380px] overflow-auto scrollbar-hide pr-1">
              {(locError || poiError) && filtered.length === 0 ? (
                <li className="text-sm px-2 py-3">
                  <span className="text-status-amber">
                    {((locError || poiError) as Error)?.message || 'Something went wrong.'}
                  </span>
                  {locError && (
                    <>
                      {' '}
                      <a href="/settings" className="text-aurora-teal underline">Set your location in Settings</a>.
                    </>
                  )}
                </li>
              ) : (
                filtered.length === 0 && <li className="text-sm text-ink-faint px-2 py-3">No matches for this filter.</li>
              )}
              {filtered.map((p) => {
                const meta = CATEGORY_META[p.category] || CATEGORY_META.water;
                const Icon = meta.Icon;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => handleSelectPoi(p)}
                      className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-ink/[0.04] ring-1 ring-transparent hover:ring-ink/10 text-left transition"
                    >
                      <div className="h-8 w-8 rounded-lg grid place-items-center shrink-0" style={{ background: `${meta.color}22`, boxShadow: `inset 0 0 0 1px ${meta.color}55` }}>
                        <Icon size={14} color={meta.color} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{p.name}</div>
                        <div className="text-[11px] text-ink-faint truncate">{poiDetail(p) || DASH}</div>
                      </div>
                      <div className="num text-xs text-ink-muted">{loc?.latitude != null && loc?.longitude != null ? fmtDistance(distanceMetres(loc.latitude, loc.longitude, p.latitude, p.longitude)) : DASH}</div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </GlassCard>
        </div>
      </div>

      {selected && (
        // Solid panel, not .glass: this popup floats over the (always
        // dark) map, where a 4.5%-opacity translucent card was
        // unreadable on a phone. Explicit white-on-navy text too, since
        // the theme-aware ink tokens go near-black in light mode and
        // would vanish against this dark panel.
        <div className="fixed bottom-24 md:bottom-8 left-4 right-4 md:left-auto md:right-8 z-50 animate-fade-in">
          <div className="w-full md:w-[320px] rounded-2xl bg-navy-800 ring-1 ring-white/15 shadow-2xl shadow-black/60 p-5">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/50">
                  {CATEGORY_META[selected.category]?.label || 'Place'}
                </div>
                {loc?.latitude != null && loc?.longitude != null && (
                  <div className="text-xs text-white/45 mt-0.5">
                    {fmtDistance(distanceMetres(loc.latitude, loc.longitude, selected.latitude, selected.longitude))} away
                  </div>
                )}
              </div>
              <button className="text-xs text-white/50 hover:text-white shrink-0" onClick={() => setSelected(null)}>close</button>
            </div>
            <div className="font-medium text-white">{selected.name || 'Unnamed place'}</div>
            <div className="text-xs text-white/60 mt-1">{poiDetail(selected) || DASH}</div>
            <div className="mt-2 num text-[11px] text-white/40">{selected.latitude.toFixed(4)}, {selected.longitude.toFixed(4)}</div>
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${selected.latitude},${selected.longitude}`}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center justify-center gap-2 w-full rounded-full px-4 py-2.5 text-sm font-semibold bg-aurora-teal text-navy-900 hover:brightness-110 transition"
            >
              <Navigation size={15} /> Directions
            </a>
            {/* Cross-reference this exact spot on Park4Night (its web map
                honours lat/lng, so it opens centred here). A secondary
                action under Directions — useful for reading reviews and
                photos of a place the OSM cache only knows the location
                of. */}
            <a
              href={park4nightUrl(selected.latitude, selected.longitude)}
              target="_blank"
              rel="noreferrer"
              data-testid={NEARBY.poiProvider('park4night')}
              className="mt-2 inline-flex items-center justify-center gap-2 w-full rounded-full px-4 py-2.5 text-sm font-medium bg-white/5 ring-1 ring-inset ring-white/15 text-white/80 hover:bg-white/10 transition"
            >
              <ExternalLink size={14} /> Open in Park4Night
            </a>
          </div>
        </div>
      )}

      {selectedCoverage && (
        <div className="fixed bottom-24 md:bottom-8 left-4 right-4 md:left-auto md:right-8 z-50 animate-fade-in">
          <div className="w-full md:w-[320px] rounded-2xl bg-navy-800 ring-1 ring-white/15 shadow-2xl shadow-black/60 p-5">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/50">
                  {selectedCoverage.isHere ? 'Signal — here' : 'Signal — checked spot'}
                </div>
                <div className="text-xs text-white/45 mt-0.5">
                  {selectedCoverage.result.from_cache
                    ? `Cached${selectedCoverage.result.cached_at ? ` · ${new Date(selectedCoverage.result.cached_at * 1000).toLocaleDateString()}` : ''}`
                    : 'Just checked'}
                </div>
              </div>
              <button className="text-xs text-white/50 hover:text-white shrink-0" onClick={() => setSelectedCoverage(null)}>close</button>
            </div>
            <div className="font-medium text-white">{selectedCoverage.label}</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {selectedCoverage.result.operators.map((op) => {
                const label = op.data_outdoor.label ?? 'unknown';
                const Icon = COVERAGE_ICON[label] ?? SignalZero;
                const colour = COVERAGE_PIN_COLOUR[label] ?? COVERAGE_PIN_COLOUR.unknown;
                return (
                  <div key={op.key} className="flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-2">
                    <Icon size={14} color={colour} />
                    <div className="min-w-0">
                      <div className="text-xs text-white/85 truncate">{op.name}</div>
                      <div className="text-[11px] text-white/45 capitalize">{label}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <a
              href="/coverage"
              className="mt-4 inline-flex items-center justify-center gap-2 w-full rounded-full px-4 py-2.5 text-sm font-semibold bg-aurora-teal text-navy-900 hover:brightness-110 transition"
            >
              <SignalHigh size={15} /> Full coverage detail
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * "Find a spot" — jump out to the crowd-sourced campervan directories to
 * cross-reference tonight's stop. Bongo's own map is OpenStreetMap data;
 * these are the big community sites (reviews, photos, bookings) that have
 * no usable read API, so a deep-link is the honest way to integrate them.
 * Park4Night centres on the van's current location; Pitchup can't take
 * coordinates, so it opens its "near me" search (labelled as such).
 */
function SpotCard({ lat, lng }: { lat: number | null; lng: number | null }) {
  const hasLoc = lat != null && lng != null;
  return (
    <GlassCard className="p-6" data-testid={NEARBY.spotCard}>
      <CardHeader
        label="Find a spot"
        hint="opens the community sites"
        right={<Compass size={14} className="text-aurora-teal" />}
      />
      <div className="text-sm text-ink-soft leading-relaxed">
        Cross-reference this area on the big campervan directories — reviews,
        photos and bookings Bongo&apos;s own map doesn&apos;t carry.
      </div>
      <div className="mt-4 space-y-2">
        {SPOT_PROVIDERS.map((p) => {
          // Park4Night needs the van's coordinates to centre; if we don't
          // have a fix yet, disable it rather than open an un-centred map.
          const needsLoc = p.centres;
          const disabled = needsLoc && !hasLoc;
          const href = hasLoc ? p.href(lat!, lng!) : p.href(0, 0);
          return (
            <a
              key={p.key}
              href={disabled ? undefined : href}
              target="_blank"
              rel="noreferrer"
              data-testid={NEARBY.spotProvider(p.key)}
              aria-disabled={disabled}
              title={p.blurb}
              className={cn(
                'flex items-center justify-between gap-3 rounded-xl px-4 py-3 ring-1 ring-inset transition',
                disabled
                  ? 'bg-ink/[0.03] ring-ink/10 text-ink-faint cursor-not-allowed pointer-events-none'
                  : 'bg-ink/[0.04] ring-ink/10 text-ink-soft hover:bg-ink/[0.08] hover:text-ink',
              )}
            >
              <div className="min-w-0">
                <div className="text-sm font-medium">{p.label}</div>
                <div className="text-[11px] text-ink-faint truncate">
                  {disabled ? 'Waiting for a location fix…' : p.centres ? 'Centred on the van' : 'Near your device'}
                </div>
              </div>
              <ExternalLink size={15} className="shrink-0" />
            </a>
          );
        })}
      </div>
    </GlassCard>
  );
}

/**
 * The Signal chip's sidebar summary — the van's current predicted 4G,
 * plus a scroll-back list of everywhere else already checked. The full
 * per-network breakdown (indoor/outdoor, voice, "relies on 4G") stays
 * on the dedicated Coverage page; this card is the "am I about to lose
 * signal here" glance, not a replacement for it.
 */
function SignalCard({
  status,
  here,
  hereError,
  hereFetching,
  recent,
  onSelectRecent,
  areaCount,
  areaFetching,
  areaError,
}: {
  status: CoverageStatus | undefined;
  here: CoverageResult | undefined;
  hereError: unknown;
  hereFetching: boolean;
  recent: CoverageResult[];
  onSelectRecent: (p: CoveragePin) => void;
  areaCount: number | undefined;
  areaFetching: boolean;
  areaError: unknown;
}) {
  const configured = status?.configured ?? true; // undefined while loading — don't flash "not configured"
  const homeOp = here?.operators.find((o) => o.key === status?.home_network) ?? here?.operators[0];
  const ratingLabel = (homeOp?.data_outdoor.label as CoveragePin['ratingLabel']) ?? 'unknown';
  const RatingIcon = COVERAGE_ICON[ratingLabel] ?? SignalZero;
  const errMessage = hereError instanceof Error ? hereError.message : null;

  return (
    <GlassCard className="p-6" data-testid={NEARBY.signalCard}>
      <CardHeader
        label="Signal, here"
        hint={status ? `home network: ${status.home_network}` : 'predicted 4G'}
        right={<RatingIcon size={16} style={{ color: COVERAGE_PIN_COLOUR[ratingLabel] }} />}
      />
      {!configured ? (
        <div className="text-sm text-ink-soft leading-relaxed">
          Add an Ofcom API key in <a href="/settings" className="text-aurora-teal underline">Settings → Integrations</a> to turn this on.
        </div>
      ) : hereFetching && !here ? (
        <div className="text-sm text-ink-faint">Checking…</div>
      ) : errMessage ? (
        <div className="text-sm text-status-amber">
          {errMessage}
          {errMessage.toLowerCase().includes('location') && (
            <>
              {' '}
              <a href="/settings" className="text-aurora-teal underline">Set your location</a>.
            </>
          )}
        </div>
      ) : here ? (
        <>
          <div className="flex items-center gap-2">
            <div className="text-2xl font-semibold capitalize" style={{ color: COVERAGE_PIN_COLOUR[ratingLabel] }}>
              {ratingLabel}
            </div>
            <span className="text-xs text-ink-muted">4G data, outdoors</span>
          </div>
          <div className="text-[11px] text-ink-faint mt-1">{here.place?.label || here.postcode}</div>
        </>
      ) : (
        <div className="text-sm text-ink-faint">No check yet.</div>
      )}

      {configured && (
        <div className="mt-3 text-[11px] text-ink-faint">
          {areaFetching
            ? 'Scanning the area…'
            : areaCount != null
              ? `${areaCount} spot${areaCount === 1 ? '' : 's'} checked in the last area scan.`
              : 'Tap "Scan this area" on the map for coverage anywhere you\'re looking, not just here.'}
          {areaError instanceof Error && <span className="text-status-amber"> {areaError.message}</span>}
        </div>
      )}

      {recent.length > 0 && (
        <div className="mt-4 pt-4 border-t border-ink/10">
          <div className="text-[11px] uppercase tracking-[0.18em] text-ink-muted mb-2">Recently checked</div>
          <ul className="space-y-1 max-h-[180px] overflow-auto scrollbar-hide">
            {recent.filter((r) => r.place?.latitude != null && r.place?.longitude != null).map((r, i) => {
              const op = r.operators.find((o) => o.key === status?.home_network) ?? r.operators[0];
              const label = (op?.data_outdoor.label as CoveragePin['ratingLabel']) ?? 'unknown';
              return (
                <li key={`${r.postcode}-${i}`}>
                  <button
                    type="button"
                    onClick={() => onSelectRecent({
                      key: `recent-${i}`,
                      latitude: r.place!.latitude!,
                      longitude: r.place!.longitude!,
                      label: r.place?.label || r.postcode,
                      ratingLabel: label,
                      result: r,
                      isHere: false,
                    })}
                    className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-ink/[0.04] text-left transition"
                  >
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: COVERAGE_PIN_COLOUR[label] }} />
                    <span className="text-xs text-ink-soft truncate flex-1">{r.place?.label || r.postcode}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </GlassCard>
  );
}

function AiCard({ configured }: { configured: boolean }) {
  const qc = useQueryClient();
  const enabled = configured;
  const q = useQuery({
    queryKey: ['ai-nearby'],
    queryFn: () => api.aiNearby(),
    enabled: false, // Deliberate: only run when user asks. AI calls cost money.
  });
  const regenerate = useMutation({
    mutationFn: () => api.aiNearby(true),
    onSuccess: (data) => qc.setQueryData(['ai-nearby'], data),
    onError: () => toast.error('Could not get new picks'),
  });

  return (
    <GlassCard glow="purple" className="p-6" data-testid={NEARBY.aiCard}>
      <CardHeader
        label="AI picks"
        hint={enabled ? 'ask once, costs money per call' : 'AI provider not configured'}
        right={<div className="flex items-center gap-1 text-aurora-purple"><Sparkles size={14} /><span className="text-xs">AI-generated</span></div>}
      />
      {q.data ? (
        <>
          {q.data.place_name && (
            <div className="text-sm text-ink-soft leading-relaxed">Near {q.data.place_name}.</div>
          )}
          <ul className="mt-4 space-y-3">
            {/* These are model-suggested places, NOT POI records - no
                coordinates, so no distance and no map pin. The model may
                well name a castle that isn't in the OSM cache at all,
                which is rather the point of asking it. */}
            {q.data.recommendations.map((rec, i) => {
              const meta = CATEGORY_META[rec.category] || CATEGORY_META.water;
              const Icon = meta.Icon;
              return (
                <li key={`${rec.name}-${i}`} className="flex gap-3 items-start">
                  <div className="h-9 w-9 rounded-xl grid place-items-center shrink-0" style={{ background: `${meta.color}22`, boxShadow: `inset 0 0 0 1px ${meta.color}55` }}>
                    <Icon size={16} color={meta.color} />
                  </div>
                  <div className="min-w-0">
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(rec.name)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium truncate hover:text-aurora-teal"
                    >
                      {rec.name}
                    </a>
                    <div className="text-xs text-ink-muted mt-0.5">{rec.description}</div>
                  </div>
                </li>
              );
            })}
          </ul>
          {q.data.from_cache && q.data.cached_at && (
            <div className="mt-2 text-[11px] text-ink-faint">
              Cached from {new Date(q.data.cached_at * 1000).toLocaleDateString()}
            </div>
          )}
          <div className="mt-3 flex gap-2 items-start text-[11px] text-status-amber">
            <Info size={12} className="mt-0.5 shrink-0" />
            AI-generated — please verify openings, prices, legality, and any distances/times before relying on any of these.
          </div>
          <button
            type="button"
            onClick={() => regenerate.mutate()}
            disabled={regenerate.isPending}
            className="mt-3 text-xs text-aurora-purple hover:underline disabled:opacity-50"
          >
            {regenerate.isPending ? 'Asking again…' : 'Get new picks (costs another call)'}
          </button>
        </>
      ) : (
        <div className="space-y-3">
          <div className="text-sm text-ink-soft">
            {enabled
              ? 'Ask a language model to pick tonight’s plan from the offline cache. One call per tap.'
              : 'Add an AI provider on the backend to enable this. Nothing on this page depends on it.'}
          </div>
          <button
            type="button"
            disabled={!enabled || q.isFetching}
            onClick={() => q.refetch()}
            className="rounded-full px-4 py-2 text-sm bg-aurora-purple/20 ring-1 ring-inset ring-aurora-purple/40 text-aurora-purple hover:bg-aurora-purple/30 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {q.isFetching ? 'Thinking…' : enabled ? 'Suggest tonight’s plan' : 'Not configured'}
          </button>
          {q.isError && <div className="text-xs text-status-red">Request failed. Try again or check auth.</div>}
        </div>
      )}
    </GlassCard>
  );
}

// Raw icon path fragments per category, shared by both the MapLibre glyph
// (svgFor — a bare icon dropped into a styled div) and the Google marker
// icon (googleMarkerSvg — a standalone image, so it needs its own
// background baked into the SVG since there's no wrapping div for it).
const ICON_PATHS: Record<string, string> = {
  water: `<path d='M12 22a7 7 0 0 0 7-7c0-3-2.5-6-7-13-4.5 7-7 10-7 13a7 7 0 0 0 7 7Z'/>`,
  dump_station: `<polyline points='3 6 5 6 21 6'/><path d='M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6'/>`,
  supermarket: `<circle cx='8' cy='21' r='1'/><circle cx='19' cy='21' r='1'/><path d='M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12'/>`,
  fuel: `<line x1='3' x2='15' y1='22' y2='22'/><line x1='4' x2='14' y1='9' y2='9'/><path d='M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18'/><path d='M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2 2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5'/>`,
  campsite: `<path d='M3.5 21 12 3l8.5 18'/><path d='M12 13v8'/>`,
  caravan_site: `<path d='M2 9v8h20v-4a6 6 0 0 0-6-6H2Z'/><circle cx='8' cy='17' r='2'/><path d='M10 17h8'/>`,
};

function svgFor(cat: string): string {
  const c = (CATEGORY_META[cat] || CATEGORY_META.water).color;
  const inner = ICON_PATHS[cat] || ICON_PATHS.water;
  return `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='${c}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>${inner}</svg>`;
}

/** Coverage pin — a filled dot in the rating colour, styled as a small
 *  signal-bars glyph. "Here" gets a bigger ring, everything else is a
 *  plain dot, same visual language as a traffic light rather than
 *  inventing new iconography for a three-state prediction. */
function coverageMarkerSvg(colour: string, isHere: boolean): string {
  const size = isHere ? 36 : 26;
  const c = size / 2;
  const r = isHere ? 10 : 8;
  const ring = isHere ? `<circle cx='${c}' cy='${c}' r='${r + 4}' fill='none' stroke='${colour}' stroke-width='2' opacity='0.55'/>` : '';
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}'>` +
    ring +
    `<circle cx='${c}' cy='${c}' r='${r}' fill='${colour}' stroke='#0f2942' stroke-width='2'/>` +
    `</svg>`;
}

/** Same glyph as svgFor, but as a standalone image (background rect +
 * icon) for use as a Google Maps marker icon, which has no wrapping div
 * to hang MapLibre's box-shadow/background styling off of. */
function googleMarkerSvg(cat: string): string {
  const c = (CATEGORY_META[cat] || CATEGORY_META.water).color;
  const inner = ICON_PATHS[cat] || ICON_PATHS.water;
  return `<svg xmlns='http://www.w3.org/2000/svg' width='30' height='30' viewBox='0 0 30 30'>` +
    `<rect x='1' y='1' width='28' height='28' rx='9' fill='#0f2942' fill-opacity='0.9' stroke='${c}' stroke-width='1.5'/>` +
    `<g transform='translate(7,7)'><svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='${c}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>${inner}</svg></g>` +
    `</svg>`;
}
