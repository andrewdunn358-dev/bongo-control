import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { motion, AnimatePresence } from 'framer-motion';
import { Droplet, Trash2, Utensils, Fuel, TentTree, Sparkles, Crosshair } from 'lucide-react';
import { endpoints } from '@/lib/api';
import { GlassCard, CardHeader } from '@/components/primitives/GlassCard';
import { StatusPill } from '@/components/primitives/StatusPill';
import { POI } from '@/constants/testIds';
import { cn } from '@/lib/utils';

const TYPE_META = {
  water: { icon: Droplet, color: '#22d3ee', label: 'Water' },
  dump: { icon: Trash2, color: '#a3e635', label: 'Dump' },
  food: { icon: Utensils, color: '#f472b6', label: 'Food' },
  fuel: { icon: Fuel, color: '#f59e0b', label: 'Fuel' },
  camping: { icon: TentTree, color: '#a855f7', label: 'Camp' },
};

// A free MapLibre-compatible dark style from CartoDB (no token needed).
const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// Portland OR default (only used if user denies geolocation)
const DEFAULT_CENTER = { lat: 45.5231, lng: -122.6765 };

export const NearbyPlaces = () => {
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);
  const markersRef = useRef([]);

  // Ask geolocation on mount (silently fall back)
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setCenter({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {},
      { enableHighAccuracy: false, timeout: 3000, maximumAge: 60_000 },
    );
  }, []);

  const { data: poiData } = useQuery({
    queryKey: ['poi-nearby', center.lat, center.lng],
    queryFn: () => endpoints.poiNearby(center.lat, center.lng),
  });
  const { data: aiData } = useQuery({
    queryKey: ['ai-nearby', center.lat, center.lng],
    queryFn: () => endpoints.aiNearby(center.lat, center.lng),
  });

  // Init map once
  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: [center.lng, center.lat],
      zoom: 12.5,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
     
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fly to new center
  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.flyTo({ center: [center.lng, center.lat], zoom: 12.8, essential: true });
    }
  }, [center]);

  // Update markers
  useEffect(() => {
    if (!mapRef.current || !poiData?.items) return;
    // clear old
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    // van marker (center)
    const van = document.createElement('div');
    van.innerHTML = `<div style="width:22px;height:22px;border-radius:9999px;background:radial-gradient(circle,#22d3ee 0%,rgba(34,211,238,0.15) 70%,transparent 100%);box-shadow:0 0 22px rgba(34,211,238,0.6);position:relative"><div style="position:absolute;inset:6px;background:#22d3ee;border-radius:9999px"></div></div>`;
    const vanMarker = new maplibregl.Marker({ element: van })
      .setLngLat([center.lng, center.lat])
      .addTo(mapRef.current);
    markersRef.current.push(vanMarker);

    const filtered = filter === 'all' ? poiData.items : poiData.items.filter((p) => p.type === filter);
    filtered.forEach((p) => {
      const meta = TYPE_META[p.type] || TYPE_META.water;
      const el = document.createElement('div');
      el.style.cursor = 'pointer';
      el.innerHTML = `
        <div style="width:34px;height:34px;border-radius:12px;display:grid;place-items:center;
          background:rgba(15,41,66,0.85);backdrop-filter:blur(6px);
          box-shadow:0 0 0 1px ${meta.color}55, 0 0 18px ${meta.color}55;color:${meta.color};font-size:16px">
          ${iconSvg(p.type, meta.color)}
        </div>`;
      el.onclick = () => setSelected(p);
      const m = new maplibregl.Marker({ element: el })
        .setLngLat([p.lng, p.lat])
        .addTo(mapRef.current);
      markersRef.current.push(m);
    });
  }, [poiData, filter, center]);

  const filtered = useMemo(() => {
    if (!poiData?.items) return [];
    return filter === 'all' ? poiData.items : poiData.items.filter((p) => p.type === filter);
  }, [poiData, filter]);

  const filters = [
    { key: 'all', label: 'All', testId: POI.filterAll },
    { key: 'water', label: 'Water', testId: POI.filterWater },
    { key: 'dump', label: 'Dump', testId: POI.filterDump },
    { key: 'camping', label: 'Camping', testId: POI.filterCamping },
    { key: 'fuel', label: 'Fuel', testId: POI.filterFuel },
    { key: 'food', label: 'Food', testId: POI.filterFood },
  ];

  return (
    <div data-testid={POI.root} className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-10 py-6 lg:py-10">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Nearby places</div>
          <h1 className="text-3xl md:text-5xl font-semibold text-white tracking-tight mt-1">
            What&apos;s <span className="text-aurora-teal">within reach</span>?
          </h1>
          <div className="text-sm text-slate-400 mt-2">
            Dump stations · potable water · food · fuel · camp spots · all offline-cached.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill tone="teal" data-testid={POI.cacheBadge}>OFFLINE READY</StatusPill>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm bg-white/[0.04] ring-1 ring-white/10 text-slate-200 hover:bg-white/[0.08]"
            onClick={() => setCenter({ ...center })}
          >
            <Crosshair size={14} /> Center
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4 lg:gap-6">
        <GlassCard className="col-span-12 lg:col-span-8 p-0 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
            <CardHeader label="Dark map" hint={`Center ${center.lat.toFixed(3)}, ${center.lng.toFixed(3)}`} className="mb-0" />
            <div className="flex flex-wrap gap-1.5">
              {filters.map((f) => (
                <button
                  key={f.key}
                  data-testid={f.testId}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    'text-xs px-3 py-1.5 rounded-full transition',
                    filter === f.key
                      ? 'bg-aurora-teal/15 text-aurora-teal ring-1 ring-inset ring-aurora-teal/40'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div ref={mapContainerRef} data-testid={POI.map} className="h-[420px] sm:h-[520px] lg:h-[640px] w-full" />
        </GlassCard>

        <div className="col-span-12 lg:col-span-4 space-y-4 lg:space-y-6">
          <GlassCard glow="purple" className="p-6" data-testid={POI.aiCard}>
            <CardHeader
              label="AI picks"
              hint="curated for tonight"
              right={<div className="flex items-center gap-1 text-aurora-purple"><Sparkles size={14} /><span className="text-xs">GPT-suggested</span></div>}
            />
            <div className="text-sm text-slate-200 leading-relaxed">{aiData?.summary || 'Generating overnight plan…'}</div>
            <ul className="mt-4 space-y-3">
              {(aiData?.picks || []).map((p) => {
                const meta = TYPE_META[p.poi.type] || TYPE_META.water;
                const Icon = meta.icon;
                return (
                  <li key={p.poi.id} className="flex gap-3 items-start">
                    <div className="h-9 w-9 rounded-xl grid place-items-center shrink-0"
                      style={{ background: `${meta.color}22`, boxShadow: `inset 0 0 0 1px ${meta.color}55` }}>
                      <Icon size={16} color={meta.color} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-white text-sm font-medium truncate">{p.poi.name}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{p.reason}</div>
                      <div className="text-[11px] text-slate-500 mt-1 num">{p.poi.distance_km} km · {meta.label}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </GlassCard>

          <GlassCard className="p-4" data-testid={POI.list}>
            <CardHeader label="All nearby" hint={`${filtered.length} places`} />
            <ul className="space-y-2 max-h-[380px] overflow-auto scrollbar-hide pr-1">
              {filtered.map((p) => {
                const meta = TYPE_META[p.type] || TYPE_META.water;
                const Icon = meta.icon;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(p)}
                      className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-white/[0.04] ring-1 ring-transparent hover:ring-white/10 text-left transition"
                    >
                      <div className="h-8 w-8 rounded-lg grid place-items-center shrink-0"
                        style={{ background: `${meta.color}22`, boxShadow: `inset 0 0 0 1px ${meta.color}55` }}>
                        <Icon size={14} color={meta.color} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-white truncate">{p.name}</div>
                        <div className="text-[11px] text-slate-500 truncate">{p.note}</div>
                      </div>
                      <div className="num text-xs text-slate-400">{p.distance_km} km</div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </GlassCard>
        </div>
      </div>

      <AnimatePresence>
        {selected && (
          <motion.div
            key={selected.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-24 md:bottom-8 right-4 md:right-8 z-50"
          >
            <GlassCard glow="teal" className="p-5 w-[300px]">
              <CardHeader
                label={TYPE_META[selected.type]?.label || 'Place'}
                hint={`${selected.distance_km} km away`}
                right={
                  <button className="text-xs text-slate-400 hover:text-white" onClick={() => setSelected(null)}>close</button>
                }
              />
              <div className="text-white font-medium">{selected.name}</div>
              <div className="text-xs text-slate-400 mt-1">{selected.note}</div>
              <div className="mt-3 num text-[11px] text-slate-500">
                {selected.lat.toFixed(4)}, {selected.lng.toFixed(4)}
              </div>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

function iconSvg(type, color) {
  const c = color;
  switch (type) {
    case 'water':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a7 7 0 0 0 7-7c0-3-2.5-6-7-13-4.5 7-7 10-7 13a7 7 0 0 0 7 7Z"/></svg>`;
    case 'dump':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>`;
    case 'food':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v20"/><path d="M7 2v10a4 4 0 0 1-4 4"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.7 1.3 3 3 3h2z"/></svg>`;
    case 'fuel':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" x2="15" y1="22" y2="22"/><line x1="4" x2="14" y1="9" y2="9"/><path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"/><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2 2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5"/></svg>`;
    case 'camping':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 21 12 3l8.5 18"/><path d="M12 13v8"/></svg>`;
    default:
      return '';
  }
}
