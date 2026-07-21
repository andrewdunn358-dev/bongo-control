import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import maplibregl from 'maplibre-gl';
import { Droplet, Trash2, Utensils, Fuel, TentTree, Sparkles, RefreshCw, Info } from 'lucide-react';
import { GlassCard, CardHeader } from '@/components/primitives/GlassCard';
import { StatusPill } from '@/components/primitives/StatusPill';
import { api } from '@/lib/api';
import { fmtDistance, DASH } from '@/lib/format';
import { readStored, writeStored } from '@/lib/theme';
import { NEARBY } from '@/constants/testIds';
import { cn } from '@/lib/utils';
import type { PoiItem } from '@/lib/types';

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
    if (!mapRef.current || !poi?.items) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (loc?.latitude != null && loc?.longitude != null) {
      const van = document.createElement('div');
      van.style.cssText = 'width:22px;height:22px;border-radius:9999px;background:radial-gradient(circle,#22d3ee 0%,rgba(34,211,238,0.15) 70%,transparent 100%);box-shadow:0 0 22px rgba(34,211,238,0.6);position:relative';
      van.innerHTML = '<div style="position:absolute;inset:6px;background:#22d3ee;border-radius:9999px"></div>';
      const m = new maplibregl.Marker({ element: van }).setLngLat([loc.longitude, loc.latitude]).addTo(mapRef.current);
      markersRef.current.push(m);
    }

    poi.items.forEach((p) => {
      const meta = CATEGORY_META[p.category] || CATEGORY_META.water;
      const el = document.createElement('div');
      el.style.cursor = 'pointer';
      el.style.cssText = `width:34px;height:34px;border-radius:12px;display:grid;place-items:center;background:rgba(15,41,66,0.85);backdrop-filter:blur(6px);box-shadow:0 0 0 1px ${meta.color}55, 0 0 18px ${meta.color}55;color:${meta.color};`;
      el.innerHTML = svgFor(p.category);
      el.onclick = () => setSelected(p);
      const m = new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(mapRef.current!);
      markersRef.current.push(m);
    });
  }, [poi, loc]);

  const filtered = useMemo(() => poi?.items ?? [], [poi]);

  return (
    <div data-testid={NEARBY.root} className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-10 py-6 lg:py-10">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-ink-muted">Nearby</div>
          <h1 className="text-3xl md:text-5xl font-semibold tracking-tight mt-1">What&apos;s <span className="text-aurora-teal">within reach</span>?</h1>
          <div className="text-sm text-ink-muted mt-2">Dump · water · food · fuel · camp spots · offline cached for 7 days.</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusPill tone={poi?.cached ? 'amber' : 'teal'} data-testid={NEARBY.offlineBadge}>
            {poi?.cached ? `OFFLINE · ${poi.cached_at ? new Date(poi.cached_at).toLocaleDateString() : 'cached'}` : 'LIVE'}
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
                        <div className="text-[11px] text-ink-faint truncate">{p.note || DASH}</div>
                      </div>
                      <div className="num text-xs text-ink-muted">{fmtDistance(p.distance_m)}</div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </GlassCard>
        </div>
      </div>

      {selected && (
        <div className="fixed bottom-24 md:bottom-8 right-4 md:right-8 z-50 animate-fade-in">
          <GlassCard glow="teal" className="p-5 w-[300px]">
            <CardHeader
              label={CATEGORY_META[selected.category]?.label || 'Place'}
              hint={`${fmtDistance(selected.distance_m)} away`}
              right={<button className="text-xs text-ink-muted hover:text-ink" onClick={() => setSelected(null)}>close</button>}
            />
            <div className="font-medium">{selected.name}</div>
            <div className="text-xs text-ink-muted mt-1">{selected.note || DASH}</div>
            <div className="mt-3 num text-[11px] text-ink-faint">{selected.lat.toFixed(4)}, {selected.lng.toFixed(4)}</div>
          </GlassCard>
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
          <div className="text-sm text-ink-soft leading-relaxed">{q.data.summary}</div>
          <ul className="mt-4 space-y-3">
            {q.data.picks.map((pk) => {
              const meta = CATEGORY_META[pk.poi.category] || CATEGORY_META.water;
              const Icon = meta.Icon;
              return (
                <li key={pk.poi.id} className="flex gap-3 items-start">
                  <div className="h-9 w-9 rounded-xl grid place-items-center shrink-0" style={{ background: `${meta.color}22`, boxShadow: `inset 0 0 0 1px ${meta.color}55` }}>
                    <Icon size={16} color={meta.color} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{pk.poi.name}</div>
                    <div className="text-xs text-ink-muted mt-0.5">{pk.reason}</div>
                    <div className="text-[11px] text-ink-faint mt-1 num">{fmtDistance(pk.poi.distance_m)} · {meta.label}</div>
                  </div>
                </li>
              );
            })}
          </ul>
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
