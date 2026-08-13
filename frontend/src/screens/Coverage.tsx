import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import maplibregl from 'maplibre-gl';
import { Search, SignalHigh, SignalLow, SignalZero, Loader2, Navigation, Info, AlertTriangle, Maximize2, Minimize2 } from 'lucide-react';
import { GlassCard } from '@/components/primitives/GlassCard';
import { StatusPill } from '@/components/primitives/StatusPill';
import { api, ApiError } from '@/lib/api';
import { isDemo } from '@/lib/demo';
import { loadGoogleMaps } from '@/lib/googleMaps';
import { COVERAGE } from '@/constants/testIds';
import { cn } from '@/lib/utils';
import { MAP_STYLE_URL } from '@/lib/mapStyle';
import type { CoverageOperator, CoverageRating, CoverageResult } from '@/lib/types';

const DEFAULT_CENTRE: [number, number] = [-2.0, 54.0];

/**
 * Ofcom's scale, verbatim: 0 = none, 3 = limited, 4 = likely. 1 and 2
 * are retired but mapped so an unexpected value renders as something
 * rather than nothing.
 *
 * Deliberately no invented middle ground and no bars-out-of-five — this
 * is a three-state prediction and dressing it up as a finer measurement
 * than it is would be the same sin as a fabricated battery percentage.
 */
const RATING_STYLE: Record<string, { text: string; ring: string; bg: string; Icon: typeof SignalHigh; word: string }> = {
  likely:  { text: 'text-status-green', ring: 'ring-status-green/40', bg: 'bg-status-green/10', Icon: SignalHigh, word: 'Likely' },
  limited: { text: 'text-amber-400',    ring: 'ring-amber-400/40',    bg: 'bg-amber-400/10',    Icon: SignalLow,  word: 'Limited' },
  none:    { text: 'text-red-400',      ring: 'ring-red-400/40',      bg: 'bg-red-400/10',      Icon: SignalZero, word: 'None' },
  unknown: { text: 'text-ink-faint',    ring: 'ring-ink/15',          bg: 'bg-ink/[0.04]',      Icon: SignalZero, word: 'Unknown' },
};

const styleFor = (rating?: CoverageRating | null) => RATING_STYLE[rating?.label ?? 'unknown'] ?? RATING_STYLE.unknown;

/** Pin colours for the map. Kept as literal hex rather than the Tailwind
 *  tokens above because both map renderers draw markers outside the
 *  stylesheet (raw DOM / SVG data-URIs) — same three states, same meaning. */
const PIN_COLOUR: Record<string, string> = {
  likely: '#22c55e',
  limited: '#fbbf24',
  none: '#f87171',
  unknown: '#64748b',
};

/** Dot-in-a-ring glyph for Google's Marker icon (which has no wrapping
 *  div to hang a box-shadow off, unlike the MapLibre markers). Ring is
 *  bigger for a single highlighted point; plain dot otherwise. */
function coveragePinSvg(colour: string, big = false): string {
  const size = big ? 34 : 22;
  const c = size / 2;
  const r = big ? 9 : 7;
  const ring = big ? `<circle cx='${c}' cy='${c}' r='${r + 4}' fill='none' stroke='${colour}' stroke-width='2' opacity='0.55'/>` : '';
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}'>${ring}<circle cx='${c}' cy='${c}' r='${r}' fill='${colour}' stroke='#0f2942' stroke-width='2'/></svg>`;
}

function fmtAge(cachedAt: number | null | undefined): string {
  if (!cachedAt) return '';
  const mins = Math.max(0, Math.round((Date.now() / 1000 - cachedAt) / 60));
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** One network's verdict. The home network gets the large treatment;
 *  the other three are compact, because the question is almost always
 *  "will MY phone work there". */
function OperatorCard({ op, primary }: { op: CoverageOperator; primary: boolean }) {
  const outdoor = styleFor(op.data_outdoor);
  const indoor = styleFor(op.data_indoor);
  const voice = styleFor(op.voice_outdoor);

  return (
    <div
      data-testid={COVERAGE.operator(op.key)}
      className={cn(
        'rounded-2xl ring-1 p-3',
        primary ? cn('col-span-2', outdoor.bg, outdoor.ring) : 'bg-white/[0.04] ring-white/10',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <outdoor.Icon size={primary ? 20 : 15} className={outdoor.text} />
          <span className={cn('font-semibold tracking-tight text-white', primary ? 'text-base' : 'text-sm')}>{op.name}</span>
        </div>
        {primary && <StatusPill tone="teal">Your network</StatusPill>}
      </div>

      <div className={cn('mt-1.5 font-semibold', primary ? 'text-xl' : 'text-base', outdoor.text)}>
        {outdoor.word}
        <span className="text-white/45 font-normal text-[11px] ml-2">4G data, outdoors</span>
      </div>

      <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <div className="text-white/45">
          Indoors <span className={cn('font-medium', indoor.text)}>{indoor.word}</span>
        </div>
        <div className="text-white/45">
          Calls <span className={cn('font-medium', voice.text)}>{voice.word}</span>
        </div>
      </div>

      {/* Two honesty notes Ofcom's own checker doesn't surface. */}
      {op.data_outdoor?.varies && (
        <div className="mt-1.5 text-[11px] text-white/40">
          Varies here (worst {RATING_STYLE[op.data_outdoor.worst === 4 ? 'likely' : op.data_outdoor.worst === 0 ? 'none' : 'limited']?.word.toLowerCase()}).
        </div>
      )}
      {op.data_outdoor?.relies_on_4g && (
        <div className="mt-1 text-[11px] text-white/40">Depends on 4G — no fallback here without it.</div>
      )}
    </div>
  );
}

/** Floating panel shown when a pin is tapped — replaces the old
 *  full-width ResultCard. Deliberately compact: this is a glance at one
 *  point, not a dedicated page. */
function SelectedPinPanel({ result, homeNetwork, onClose }: { result: CoverageResult; homeNetwork: string; onClose: () => void }) {
  const operators = useMemo(() => {
    const list = [...(result.operators ?? [])];
    list.sort((a, b) => Number(b.key === homeNetwork) - Number(a.key === homeNetwork));
    return list;
  }, [result.operators, homeNetwork]);
  const place = result.place;
  const farFromPostcode = (place?.postcode_distance_m ?? 0) > 750;

  return (
    <div
      data-testid={COVERAGE.result}
      className="absolute bottom-3 left-3 right-3 sm:left-auto sm:right-3 sm:w-[380px] z-20 rounded-2xl bg-navy-900/95 backdrop-blur ring-1 ring-white/15 shadow-2xl p-4 max-h-[75%] overflow-auto"
    >
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="min-w-0">
          <div className="font-semibold text-white truncate">{place?.label || result.postcode}</div>
          <div className="text-[11px] text-white/45">
            {result.from_cache ? (result.stale ? 'Offline · cached' : `Cached ${fmtAge(result.cached_at)}`) : 'Just checked'}
            {' · '}{result.address_count} address{result.address_count === 1 ? '' : 'es'}
          </div>
        </div>
        <button type="button" className="text-xs text-white/50 hover:text-white shrink-0" onClick={onClose}>close</button>
      </div>

      {farFromPostcode && (
        <div className="mt-2 flex items-start gap-2 rounded-xl p-2 bg-amber-400/10 ring-1 ring-amber-400/30 text-[11px] text-amber-200">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            Nearest postcode ~{Math.round((place?.postcode_distance_m ?? 0) / 100) / 10}km away — open ground can vary
            a lot from the nearest addresses.
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mt-2">
        {operators.map((op) => (
          <OperatorCard key={op.key} op={op} primary={op.key === homeNetwork} />
        ))}
      </div>

      <div className="mt-2 flex items-start gap-1.5 text-[10px] text-white/35">
        <Info size={11} className="mt-0.5 shrink-0" />
        <span>Predicted from Ofcom's Connected Nations data, not a measurement.</span>
      </div>
    </div>
  );
}

type FlyTarget = { lat: number; lon: number; key: number };

/**
 * The map itself — every place already checked, plus anywhere scanned,
 * as a coloured pin for your own network.
 *
 * What this is NOT, and can't be: a shaded map of the country. Ofcom
 * publish per-postcode lookups and local-authority aggregates, not a
 * tile layer, and painting a heatmap out of postcode calls would burn
 * the 50k/28-day quota in one afternoon (also, Google's own heatmap
 * layer was deprecated and removed as of May 2026). So the honest
 * overlay is real, individually-rated points: everywhere asked about,
 * plus a grid of real postcodes around wherever's scanned.
 */
function MapLibreCoverageCanvas({
  pins,
  homeNetwork,
  onPick,
  onScanArea,
  areaFetching,
  flyTarget,
}: {
  pins: CoverageResult[];
  homeNetwork: string;
  onPick: (result: CoverageResult) => void;
  onScanArea: (centre: { lat: number; lon: number }) => void;
  areaFetching: boolean;
  flyTarget: FlyTarget | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  // Camera auto-fit should happen once, to frame existing checked spots
  // on first load - NOT every time pins change (that would yank the
  // camera back toward wherever cached history clusters every time
  // "Scan this area" adds pins). An explicit flyTarget (search / "where
  // we are") counts as satisfying this too, since it's a deliberate
  // move, not an accidental one.
  const didAutoFit = useRef(false);

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const created = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: DEFAULT_CENTRE,
      zoom: 5,
      attributionControl: { compact: true },
    });
    created.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
    mapRef.current = created;
    return () => { created.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const instance = mapRef.current;
    if (!instance) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    if (pins.length === 0) return;

    pins.forEach((result) => {
      const home = result.operators?.find((o) => o.key === homeNetwork);
      const label = home?.data_outdoor?.label ?? 'unknown';
      const colour = PIN_COLOUR[label] ?? PIN_COLOUR.unknown;

      const el = document.createElement('div');
      el.style.cssText =
        `width:15px;height:15px;border-radius:9999px;background:${colour};cursor:pointer;` +
        `box-shadow:0 0 0 3px rgba(10,22,40,0.75),0 0 12px ${colour};`;
      el.title = `${result.place?.label ?? result.postcode} — ${styleFor(home?.data_outdoor).word}`;
      el.addEventListener('click', () => onPick(result));

      markersRef.current.push(
        new maplibregl.Marker({ element: el }).setLngLat([result.place!.longitude!, result.place!.latitude!]).addTo(instance),
      );
    });

    // resize() first, deliberately - the map is constructed in the same
    // effect pass that mounts its container, so MapLibre can latch a
    // zero-size transform, and a bounds-fit against a 0x0 viewport does
    // nothing at all, silently.
    instance.resize();
  }, [pins, homeNetwork, onPick]);

  // Explicit fly (search result / "where we are") always wins and
  // counts as the one-time auto-fit.
  useEffect(() => {
    const instance = mapRef.current;
    if (!instance || !flyTarget) return;
    didAutoFit.current = true;
    instance.jumpTo({ center: [flyTarget.lon, flyTarget.lat], zoom: 12 });
  }, [flyTarget]);

  // Otherwise, auto-fit exactly once, first time real pins show up.
  useEffect(() => {
    const instance = mapRef.current;
    if (!instance || didAutoFit.current || pins.length === 0) return;
    didAutoFit.current = true;
    if (pins.length === 1) {
      instance.jumpTo({ center: [pins[0].place!.longitude!, pins[0].place!.latitude!], zoom: 11 });
      return;
    }
    const first: [number, number] = [pins[0].place!.longitude!, pins[0].place!.latitude!];
    const bounds = new maplibregl.LngLatBounds(first, first);
    pins.forEach((p) => bounds.extend([p.place!.longitude!, p.place!.latitude!]));
    const doFit = () => {
      const camera = instance.cameraForBounds(bounds, { padding: 60, maxZoom: 11 });
      if (camera) instance.jumpTo(camera);
    };
    doFit();
    if (!instance.isStyleLoaded()) instance.once('load', doFit);
  }, [pins]);

  return (
    <>
      <div ref={containerRef} className="h-full w-full" />
      <button
        type="button"
        onClick={() => {
          const c = mapRef.current?.getCenter();
          if (c) onScanArea({ lat: c.lat, lon: c.lng });
        }}
        disabled={areaFetching}
        className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium bg-navy-900/90 text-white ring-1 ring-white/15 shadow-lg hover:bg-navy-900 disabled:opacity-60"
      >
        {areaFetching ? <Loader2 size={13} className="animate-spin" /> : <SignalHigh size={13} />} Scan this area
      </button>
    </>
  );
}

/** Google Maps version of the same canvas. See GoogleNearbyMap in
 *  Nearby.tsx for the twin implementation this mirrors. */
function GoogleCoverageCanvas({
  pins,
  homeNetwork,
  onPick,
  onScanArea,
  areaFetching,
  apiKey,
  flyTarget,
}: {
  pins: CoverageResult[];
  homeNetwork: string;
  onPick: (result: CoverageResult) => void;
  onScanArea: (centre: { lat: number; lon: number }) => void;
  areaFetching: boolean;
  apiKey: string;
  flyTarget: FlyTarget | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const didAutoFit = useRef(false);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps(apiKey)
      .then((g) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        mapRef.current = new g.maps.Map(containerRef.current, {
          center: { lat: DEFAULT_CENTRE[1], lng: DEFAULT_CENTRE[0] },
          zoom: 5,
          disableDefaultUI: true,
          zoomControl: true,
        });
        setReady(true);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Failed to load Google Maps'));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init once
  }, [apiKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !window.google?.maps) return;
    const g = window.google;
    markersRef.current.forEach((m) => m.setMap(null));
    if (pins.length === 0) return;

    markersRef.current = pins.map((result) => {
      const home = result.operators?.find((o) => o.key === homeNetwork);
      const label = home?.data_outdoor?.label ?? 'unknown';
      const colour = PIN_COLOUR[label] ?? PIN_COLOUR.unknown;
      const marker = new g.maps.Marker({
        position: { lat: result.place!.latitude!, lng: result.place!.longitude! },
        map,
        icon: {
          url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(coveragePinSvg(colour))}`,
          scaledSize: new g.maps.Size(22, 22),
          anchor: new g.maps.Point(11, 11),
        },
        title: `${result.place?.label ?? result.postcode} — ${styleFor(home?.data_outdoor).word}`,
      });
      marker.addListener('click', () => onPick(result));
      return marker;
    });
  }, [ready, pins, homeNetwork, onPick]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTarget) return;
    didAutoFit.current = true;
    map.panTo({ lat: flyTarget.lat, lng: flyTarget.lon });
    map.setZoom(12);
  }, [flyTarget]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.google?.maps || didAutoFit.current || pins.length === 0) return;
    const g = window.google;
    didAutoFit.current = true;
    if (pins.length === 1) {
      map.panTo({ lat: pins[0].place!.latitude!, lng: pins[0].place!.longitude! });
      map.setZoom(11);
    } else {
      const bounds = new g.maps.LatLngBounds();
      pins.forEach((p) => bounds.extend({ lat: p.place!.latitude!, lng: p.place!.longitude! }));
      map.fitBounds(bounds, 60);
    }
  }, [pins]);

  if (error) {
    return (
      <div className="h-full w-full grid place-items-center text-sm text-status-amber px-6 text-center bg-ink/[0.04]">
        {error} — check the API key in Settings → Integrations.
      </div>
    );
  }
  return (
    <>
      {/* Same fix as Trips'/Nearby's Google map components - see
          GoogleTripsMap's comment for the reported symptom (a black
          flash before the map appears) and why. The parent card
          already establishes position:relative, so this positions
          correctly without needing its own wrapper div. */}
      {!ready && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-navy-900">
          <div className="flex flex-col items-center gap-2 text-ink-muted">
            <Loader2 size={22} className="animate-spin text-aurora-teal" />
            <span className="text-xs">Loading map…</span>
          </div>
        </div>
      )}
      <div ref={containerRef} className="h-full w-full" />
      <button
        type="button"
        onClick={() => {
          const c = mapRef.current?.getCenter();
          if (c) onScanArea({ lat: c.lat(), lon: c.lng() });
        }}
        disabled={areaFetching}
        className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium bg-navy-900/90 text-white ring-1 ring-white/15 shadow-lg hover:bg-navy-900 disabled:opacity-60"
      >
        {areaFetching ? <Loader2 size={13} className="animate-spin" /> : <SignalHigh size={13} />} Scan this area
      </button>
    </>
  );
}

export function Coverage() {
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<CoverageResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [areaCenter, setAreaCenter] = useState<{ lat: number; lon: number } | null>(null);
  const [flyTarget, setFlyTarget] = useState<FlyTarget | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const status = useQuery({ queryKey: ['coverage-status'], queryFn: api.coverageStatus, retry: false });
  // Still fetched to seed the map's pins on first load - just no longer
  // rendered as a list. "Everywhere already checked" is now something
  // you see on the map, not read off a sidebar.
  const recent = useQuery({ queryKey: ['coverage-recent'], queryFn: () => api.coverageRecent(50), retry: false });
  const homeNetwork = status.data?.home_network ?? 'H3';

  const cfg = useQuery({ queryKey: ['config-general'], queryFn: () => api.getConfig('general'), enabled: !isDemo });
  const mapsApiKey = String(cfg.data?.google_maps_api_key ?? '').trim();
  const useGoogle = !isDemo && mapsApiKey.length > 0;

  // "Scan this area" — explicit tap (or a search landing somewhere new,
  // see onResult below) only. Each new postcode in range spends a real
  // Ofcom call, so this must never fire from a pan or a re-render alone.
  const { data: areaData, isFetching: areaFetching, error: areaError } = useQuery({
    queryKey: ['coverage-area', areaCenter?.lat, areaCenter?.lon],
    queryFn: () => api.coverageArea(areaCenter!.lat, areaCenter!.lon),
    enabled: !!areaCenter,
    staleTime: 5 * 60 * 1000,
  });

  const onResult = (data: CoverageResult) => {
    setSelected(data);
    setError(null);
    qc.invalidateQueries({ queryKey: ['coverage-recent'] });
    // A search (or "where we are") is exactly the "I want to know about
    // this area" signal Scan-this-area normally needs a tap for - so
    // fire it automatically here, and fly the map to match. This is
    // what makes "search for a campsite, see the area around it" one
    // action instead of search-then-remember-to-tap-scan.
    if (data.place?.latitude != null && data.place?.longitude != null) {
      setFlyTarget({ lat: data.place.latitude, lon: data.place.longitude, key: Date.now() });
      setAreaCenter({ lat: data.place.latitude, lon: data.place.longitude });
    }
  };
  const onError = (e: unknown) => {
    setSelected(null);
    setError(e instanceof ApiError || e instanceof Error ? e.message : 'Lookup failed');
  };

  const search = useMutation({ mutationFn: (q: string) => api.coverageSearch(q), onSuccess: onResult, onError });
  const here = useMutation({ mutationFn: () => api.coverageHere(), onSuccess: onResult, onError });
  const busy = search.isPending || here.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q) search.mutate(q);
  };

  // Pins: everywhere already checked, plus this area scan, deduped by
  // postcode. Rows cached before coordinates were stored are counted
  // silently below rather than dropped without explanation.
  const pins = useMemo(() => {
    const seen = new Set<string>();
    const combined: CoverageResult[] = [];
    for (const r of [...(recent.data?.results ?? []), ...(areaData?.results ?? [])]) {
      if (r.place?.latitude == null || r.place?.longitude == null) continue;
      if (seen.has(r.postcode)) continue;
      seen.add(r.postcode);
      combined.push(r);
    }
    return combined;
  }, [recent.data, areaData]);
  const unplaced = (recent.data?.results ?? []).filter((r) => r.place?.latitude == null || r.place?.longitude == null).length;

  return (
    <div data-testid={COVERAGE.root} className={cn('mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 py-6 lg:py-10', fullscreen && 'p-0 max-w-none')}>
      {!fullscreen && (
        <div className="mb-4">
          <div className="text-[11px] uppercase tracking-[0.24em] text-ink-muted">Coverage</div>
          <h1 className="text-2xl md:text-4xl font-semibold tracking-tight mt-1">
            Will there be <span className="text-aurora-teal">signal</span>?
          </h1>
        </div>
      )}

      <GlassCard className={cn('overflow-hidden', fullscreen ? 'rounded-none ring-0' : 'p-0')}>
        <div className={cn('relative w-full', fullscreen ? 'h-screen' : 'h-[68vh] min-h-[420px]')}>
          {useGoogle ? (
            <GoogleCoverageCanvas
              pins={pins}
              homeNetwork={homeNetwork}
              onPick={setSelected}
              onScanArea={setAreaCenter}
              areaFetching={areaFetching}
              apiKey={mapsApiKey}
              flyTarget={flyTarget}
            />
          ) : (
            <MapLibreCoverageCanvas
              pins={pins}
              homeNetwork={homeNetwork}
              onPick={setSelected}
              onScanArea={setAreaCenter}
              areaFetching={areaFetching}
              flyTarget={flyTarget}
            />
          )}

          {/* Search overlay - type a place, a postcode, or a named spot
              like a campsite (resolved the same way as everything else:
              postcode direct, or a place-name geocode). Submitting flies
              here and scans the area, in one action. */}
          <div className="absolute top-3 left-3 right-3 z-10 flex flex-col gap-2">
            <form onSubmit={submit} className="flex gap-2">
              <div className="relative flex-1 min-w-0">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                <input
                  data-testid={COVERAGE.search}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search a place, postcode, or campsite name…"
                  className="w-full rounded-full bg-navy-900/90 backdrop-blur ring-1 ring-white/15 focus:ring-aurora-teal/50 outline-none pl-9 pr-3 py-2 text-sm text-white placeholder:text-white/35 shadow-lg"
                />
              </div>
              <button
                type="submit"
                data-testid={COVERAGE.submit}
                disabled={busy || !query.trim()}
                className="rounded-full px-4 py-2 text-sm bg-aurora-teal text-navy-900 font-semibold hover:brightness-110 disabled:opacity-40 inline-flex items-center justify-center gap-1.5 shadow-lg shrink-0"
              >
                {search.isPending ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              </button>
              <button
                type="button"
                data-testid={COVERAGE.here}
                onClick={() => here.mutate()}
                disabled={busy}
                title="Where we are"
                className="rounded-full px-3 py-2 text-sm bg-navy-900/90 backdrop-blur ring-1 ring-white/15 text-white hover:bg-navy-900 disabled:opacity-40 inline-flex items-center justify-center shadow-lg shrink-0"
              >
                {here.isPending ? <Loader2 size={14} className="animate-spin" /> : <Navigation size={14} />}
              </button>
              <button
                type="button"
                onClick={() => setFullscreen((f) => !f)}
                title={fullscreen ? 'Exit full screen' : 'Full screen'}
                className="rounded-full px-3 py-2 text-sm bg-navy-900/90 backdrop-blur ring-1 ring-white/15 text-white hover:bg-navy-900 inline-flex items-center justify-center shadow-lg shrink-0"
              >
                {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
            </form>

            {status.data && !status.data.configured && (
              <div className="rounded-xl px-3 py-2 bg-amber-400/15 backdrop-blur ring-1 ring-amber-400/30 text-xs text-amber-200 shadow-lg">
                No Ofcom API key set — add one in Settings → Integrations. Anything already cached still works.
              </div>
            )}
            {error && (
              <div className="rounded-xl px-3 py-2 bg-red-500/15 backdrop-blur ring-1 ring-red-500/30 text-xs text-red-200 shadow-lg">{error}</div>
            )}
            {areaError instanceof Error && (
              <div className="rounded-xl px-3 py-2 bg-amber-400/15 backdrop-blur ring-1 ring-amber-400/30 text-xs text-amber-200 shadow-lg">
                {areaError.message}
              </div>
            )}
          </div>

          {/* Legend - bottom left, opposite the Scan-this-area button. */}
          <div className="absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-3 py-2 bg-navy-900/90 backdrop-blur ring-1 ring-white/15 text-[11px] text-white/60 shadow-lg">
            {(['likely', 'limited', 'none'] as const).map((key) => (
              <span key={key} className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: PIN_COLOUR[key] }} />
                {RATING_STYLE[key].word}
              </span>
            ))}
          </div>

          {selected && <SelectedPinPanel result={selected} homeNetwork={homeNetwork} onClose={() => setSelected(null)} />}
        </div>
      </GlassCard>

      {!fullscreen && (
        <div className="mt-3 flex items-start gap-2 text-[11px] text-ink-faint px-1">
          <Info size={12} className="mt-0.5 shrink-0" />
          <span>
            Predicted coverage from Ofcom's Connected Nations data — a model of what networks report, not a
            measurement. Real signal varies with terrain, weather, buildings and how busy the mast is.
            {unplaced > 0 && ` ${unplaced} older ${unplaced === 1 ? 'lookup has' : 'lookups have'} no saved coordinates, so ${unplaced === 1 ? "it isn't" : "they aren't"} on the map — searching again places ${unplaced === 1 ? 'it' : 'them'}.`}
          </span>
        </div>
      )}
    </div>
  );
}
