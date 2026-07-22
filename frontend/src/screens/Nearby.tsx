import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import maplibregl from 'maplibre-gl';
import { Droplet, Trash2, Utensils, Fuel, TentTree, Sparkles, RefreshCw, Info, Navigation } from 'lucide-react';
import { GlassCard, CardHeader } from '@/components/primitives/GlassCard';
import { StatusPill } from '@/components/primitives/StatusPill';
import { api } from '@/lib/api';
import { fmtDistance, DASH } from '@/lib/format';
import { readStored, writeStored } from '@/lib/theme';
import { NEARBY } from '@/constants/testIds';
import { cn } from '@/lib/utils';
import type { PoiItem } from '@/lib/types';

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


const CATEGORY_META: Record<string, { Icon: typeof Droplet; color: string; label: string }> = {
  water:   { Icon: Droplet, color: '#22d3ee', label: 'Water' },
  dump:    { Icon: Trash2,  color: '#a3e635', label: 'Dump' },
  food:    { Icon: Utensils,color: '#f472b6', label: 'Food' },
  fuel:    { Icon: Fuel,    color: '#f59e0b', label: 'Fuel' },
  camping: { Icon: TentTree,color: '#a855f7', label: 'Camping' },
};

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const FILTER_KEY = 'bongo.nearby.filter';
const CATEGORIES = ['all', 'water', 'dump', 'camping', 'fuel', 'food'] as const;

export function Nearby() {
  const [filter, setFilter] = useState<string>(() => readStored<string>(FILTER_KEY, 'all'));
  const [selected, setSelected] = useState<PoiItem | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  useEffect(() => { writeStored(FILTER_KEY, filter); }, [filter]);

  // Backend owns location — we just ask.
  const { data: loc } = useQuery({ queryKey: ['location'], queryFn: api.location });

  const { data: poi, refetch, isFetching } = useQuery({
    queryKey: ['poi-nearby', filter],
    queryFn: () => api.poiNearby({ categories: filter === 'all' ? undefined : [filter] }),
  });
  const { data: aiStatus } = useQuery({ queryKey: ['ai-status'], queryFn: api.aiStatus });

  // Init map
  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return;
    const center: [number, number] = [loc?.longitude ?? -122.6765, loc?.latitude ?? 45.5231];
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center,
      zoom: 12.5,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-centre when backend location arrives
  useEffect(() => {
    if (mapRef.current && loc?.latitude != null && loc?.longitude != null) {
      mapRef.current.flyTo({ center: [loc.longitude, loc.latitude], zoom: 12.8, essential: true });
    }
  }, [loc?.latitude, loc?.longitude]);

  // Render markers
  useEffect(() => {
    if (!mapRef.current || !poi?.results) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (loc?.latitude != null && loc?.longitude != null) {
      const van = document.createElement('div');
      van.style.cssText = 'width:22px;height:22px;border-radius:9999px;background:radial-gradient(circle,#22d3ee 0%,rgba(34,211,238,0.15) 70%,transparent 100%);box-shadow:0 0 22px rgba(34,211,238,0.6);position:relative';
      van.innerHTML = '<div style="position:absolute;inset:6px;background:#22d3ee;border-radius:9999px"></div>';
      const m = new maplibregl.Marker({ element: van }).setLngLat([loc.longitude, loc.latitude]).addTo(mapRef.current);
      markersRef.current.push(m);
    }

    poi.results.forEach((p) => {
      const meta = CATEGORY_META[p.category] || CATEGORY_META.water;
      const el = document.createElement('div');
      el.style.cursor = 'pointer';
      el.style.cssText = `width:34px;height:34px;border-radius:12px;display:grid;place-items:center;background:rgba(15,41,66,0.85);backdrop-filter:blur(6px);box-shadow:0 0 0 1px ${meta.color}55, 0 0 18px ${meta.color}55;color:${meta.color};`;
      el.innerHTML = svgFor(p.category);
      el.onclick = () => setSelected(p);
      const m = new maplibregl.Marker({ element: el }).setLngLat([p.longitude, p.latitude]).addTo(mapRef.current!);
      markersRef.current.push(m);
    });
  }, [poi, loc]);

  const filtered = useMemo(() => poi?.results ?? [], [poi]);

  return (
    <div data-testid={NEARBY.root} className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-10 py-6 lg:py-10">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-ink-muted">Nearby</div>
          <h1 className="text-3xl md:text-5xl font-semibold tracking-tight mt-1">What&apos;s <span className="text-aurora-teal">within reach</span>?</h1>
          <div className="text-sm text-ink-muted mt-2">Dump · water · food · fuel · camp spots · offline cached for 7 days.</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusPill tone={poi?.from_cache ? 'amber' : 'teal'} data-testid={NEARBY.offlineBadge}>
            {poi?.from_cache ? `OFFLINE · ${poi.cached_at ? new Date(poi.cached_at * 1000).toLocaleDateString() : 'cached'}` : 'LIVE'}
          </StatusPill>
          <button
            type="button"
            data-testid={NEARBY.refresh}
            onClick={() => refetch()}
            className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm bg-ink/[0.04] ring-1 ring-ink/10 text-ink-soft hover:bg-ink/[0.08]"
          >
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4 lg:gap-6">
        <GlassCard className="col-span-12 lg:col-span-8 p-0 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-ink/5">
            <CardHeader label="Dark map" className="mb-0" hint={loc?.latitude ? `${loc.latitude?.toFixed(3)}, ${loc.longitude?.toFixed(3)}` : 'location loading'} />
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  data-testid={NEARBY.filter(c)}
                  onClick={() => setFilter(c)}
                  className={cn(
                    'text-xs px-3 py-1.5 rounded-full transition',
                    filter === c ? 'bg-aurora-teal/15 text-aurora-teal ring-1 ring-inset ring-aurora-teal/40' : 'text-ink-muted hover:text-ink hover:bg-ink/5',
                  )}
                >
                  {c === 'all' ? 'All' : CATEGORY_META[c]?.label || c}
                </button>
              ))}
            </div>
          </div>
          <div ref={mapContainerRef} data-testid={NEARBY.map} className="h-[440px] sm:h-[520px] lg:h-[640px] w-full" />
        </GlassCard>

        <div className="col-span-12 lg:col-span-4 space-y-4 lg:space-y-6">
          <AiCard configured={aiStatus?.configured ?? false} />
          <GlassCard className="p-4" data-testid={NEARBY.list}>
            <CardHeader label="All nearby" hint={`${filtered.length} places`} />
            <ul className="space-y-2 max-h-[380px] overflow-auto scrollbar-hide pr-1">
              {filtered.length === 0 && <li className="text-sm text-ink-faint px-2 py-3">No matches for this filter.</li>}
              {filtered.map((p) => {
                const meta = CATEGORY_META[p.category] || CATEGORY_META.water;
                const Icon = meta.Icon;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(p)}
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
          </div>
        </div>
      )}
    </div>
  );
}

function AiCard({ configured }: { configured: boolean }) {
  const enabled = configured;
  const q = useQuery({
    queryKey: ['ai-nearby'],
    queryFn: api.aiNearby,
    enabled: false, // Deliberate: only run when user asks. AI calls cost money.
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
            AI-generated — please verify openings, prices, and legality before relying on any of these.
          </div>
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

function svgFor(cat: string): string {
  const c = (CATEGORY_META[cat] || CATEGORY_META.water).color;
  const stroke = `stroke='${c}'`;
  switch (cat) {
    case 'water':
      return `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' ${stroke} stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M12 22a7 7 0 0 0 7-7c0-3-2.5-6-7-13-4.5 7-7 10-7 13a7 7 0 0 0 7 7Z'/></svg>`;
    case 'dump':
      return `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' ${stroke} stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='3 6 5 6 21 6'/><path d='M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6'/></svg>`;
    case 'food':
      return `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' ${stroke} stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M3 2v20'/><path d='M7 2v10a4 4 0 0 1-4 4'/><path d='M21 15V2a5 5 0 0 0-5 5v6c0 1.7 1.3 3 3 3h2z'/></svg>`;
    case 'fuel':
      return `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' ${stroke} stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><line x1='3' x2='15' y1='22' y2='22'/><line x1='4' x2='14' y1='9' y2='9'/><path d='M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18'/><path d='M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2 2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5'/></svg>`;
    case 'camping':
      return `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' ${stroke} stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M3.5 21 12 3l8.5 18'/><path d='M12 13v8'/></svg>`;
    default:
      return '';
  }
}
