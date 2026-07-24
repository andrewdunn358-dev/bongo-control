import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import maplibregl from 'maplibre-gl';
import { Route, MapPin, Flag, CalendarDays } from 'lucide-react';
import { GlassCard, CardHeader } from '@/components/primitives/GlassCard';
import { StatusPill } from '@/components/primitives/StatusPill';
import { api } from '@/lib/api';
import { fmtDistance, DASH } from '@/lib/format';
import { TRIPS } from '@/constants/testIds';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

type Point = { timestamp: number; latitude: number; longitude: number; source: string };

function haversineMetres(a: Point, b: Point): number {
  const R = 6_371_000;
  const p1 = (a.latitude * Math.PI) / 180;
  const p2 = (b.latitude * Math.PI) / 180;
  const dp = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dl = ((b.longitude - a.longitude) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function Trips() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  const { data } = useQuery({ queryKey: ['location-history'], queryFn: api.locationHistory });
  const points = useMemo<Point[]>(() => data?.points ?? [], [data]);

  const stats = useMemo(() => {
    if (points.length < 1) return { distance: 0, days: 0, points: points.length };
    let distance = 0;
    for (let i = 1; i < points.length; i++) distance += haversineMetres(points[i - 1], points[i]);
    const spanDays = (points[points.length - 1].timestamp - points[0].timestamp) / 86400;
    return { distance, days: Math.max(1, Math.ceil(spanDays || 0)), points: points.length };
  }, [points]);

  // Init map once
  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: [-1.446, 55.011],
      zoom: 5,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Draw the trail whenever points change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || points.length === 0) return;

    const draw = () => {
      const coords = points.map((p) => [p.longitude, p.latitude] as [number, number]);
      const geojson = {
        type: 'FeatureCollection' as const,
        features: [{ type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: coords }, properties: {} }],
      };

      const existing = map.getSource('trip') as maplibregl.GeoJSONSource | undefined;
      if (existing) {
        existing.setData(geojson as never);
      } else {
        map.addSource('trip', { type: 'geojson', data: geojson as never });
        map.addLayer({
          id: 'trip-line',
          type: 'line',
          source: 'trip',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#22d3ee', 'line-width': 3, 'line-opacity': 0.9 },
        });
      }

      // Start / current markers
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      const mk = (lngLat: [number, number], color: string) => {
        const el = document.createElement('div');
        el.style.cssText = `width:14px;height:14px;border-radius:9999px;background:${color};box-shadow:0 0 0 3px rgba(10,22,40,0.7),0 0 12px ${color};`;
        markersRef.current.push(new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map));
      };
      mk(coords[0], '#a855f7');
      if (coords.length > 1) mk(coords[coords.length - 1], '#22d3ee');

      // Fit the map to the trail
      const b = new maplibregl.LngLatBounds(coords[0], coords[0]);
      coords.forEach((c) => b.extend(c));
      map.fitBounds(b, { padding: 60, maxZoom: 13, duration: 600 });
    };

    if (map.isStyleLoaded()) draw();
    else map.once('load', draw);
  }, [points]);

  const empty = points.length === 0;

  return (
    <div data-testid={TRIPS.root} className="mx-auto max-w-[1500px] px-4 sm:px-6 lg:px-10 py-6 lg:py-10">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-ink-muted">Trips</div>
          <h1 className="text-3xl md:text-5xl font-semibold tracking-tight mt-1">
            Where the van has <span className="text-aurora-teal">been</span>
          </h1>
          <div className="text-sm text-ink-muted mt-2">Your trail, recorded from GPS as you go. The start of your trips &amp; memories log.</div>
        </div>
        <StatusPill tone={empty ? 'slate' : 'teal'}>{empty ? 'NO TRAIL YET' : `${stats.points} POINTS`}</StatusPill>
      </div>

      <div className="grid grid-cols-12 gap-4 lg:gap-6">
        <GlassCard className="col-span-6 md:col-span-4 p-6">
          <CardHeader label="Distance travelled" hint="along the trail" right={<Route size={16} className="text-aurora-teal" />} />
          <div className="num text-4xl font-semibold">{empty ? DASH : fmtDistance(stats.distance)}</div>
        </GlassCard>
        <GlassCard className="col-span-6 md:col-span-4 p-6">
          <CardHeader label="Days logged" hint="first fix to now" right={<CalendarDays size={16} className="text-aurora-teal" />} />
          <div className="num text-4xl font-semibold">{empty ? DASH : stats.days}</div>
        </GlassCard>
        <GlassCard className="col-span-12 md:col-span-4 p-6">
          <CardHeader label="Breadcrumbs" hint="GPS points saved" right={<MapPin size={16} className="text-aurora-teal" />} />
          <div className="num text-4xl font-semibold">{stats.points}</div>
        </GlassCard>

        <GlassCard className="col-span-12 p-0 overflow-hidden">
          <div data-testid={TRIPS.map} ref={mapContainerRef} className="w-full h-[60vh] min-h-[360px]" />
          {empty && (
            <div className="px-5 py-4 flex items-start gap-3 text-sm text-ink-muted">
              <Flag size={16} className="text-aurora-purple mt-0.5 shrink-0" />
              <div>
                No trail recorded yet. Once your phone has set the location from GPS a few times (it does this automatically),
                your route will start drawing here — a purple dot where you began, teal where you are now.
              </div>
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
