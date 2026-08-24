import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import maplibregl from 'maplibre-gl';
import { Route, MapPin, Flag, CalendarDays, BookOpen, Trash2, Check, Loader2 } from 'lucide-react';
import { GlassCard, CardHeader } from '@/components/primitives/GlassCard';
import { StatusPill } from '@/components/primitives/StatusPill';
import { api } from '@/lib/api';
import { isDemo } from '@/lib/demo';
import { loadGoogleMaps } from '@/lib/googleMaps';
import { fmtDistance, DASH } from '@/lib/format';
import { TRIPS } from '@/constants/testIds';
import { MapOfflineControls } from '@/components/MapOfflineControls';
import { MAP_STYLE_URL } from '@/lib/mapStyle';
import type { Place, PlaceCandidate } from '@/lib/types';

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

function fmtDay(sec: number): string {
  return new Date(sec * 1000).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/** Google Maps rendering of the trail + place pins. */
function GoogleTripsMap({ points, places, apiKey }: { points: Point[]; places: Place[]; apiKey: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const placeMarkersRef = useRef<google.maps.Marker[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mapType, setMapType] = useState<'roadmap' | 'hybrid'>('roadmap');
  // See the identical comment in GoogleNearbyMap (Nearby.tsx) - setting
  // mapRef.current alone doesn't cause a re-render, so without this any
  // drawing effect that ran (and bailed out) before the async map load
  // finished would never get a second chance unless points/places
  // happened to change again afterward.
  const [mapReady, setMapReady] = useState(false);

  // Init map once
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps(apiKey)
      .then((g) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        mapRef.current = new g.maps.Map(containerRef.current, {
          center: { lat: 55.011, lng: -1.446 },
          zoom: 5,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
        });
        infoWindowRef.current = new g.maps.InfoWindow();
        setMapReady(true);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load Google Maps'));
    return () => { cancelled = true; };
  }, [apiKey]);

  // Map/Satellite toggle. Google's own mapTypeControl UI chrome doesn't
  // match the app's look, so this is a small custom pill instead - see
  // the render below.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.google?.maps) return;
    map.setMapTypeId(mapType === 'hybrid' ? window.google.maps.MapTypeId.HYBRID : window.google.maps.MapTypeId.ROADMAP);
  }, [mapReady, mapType]);

  // Draw the trail
  useEffect(() => {
    const map = mapRef.current;
    if (!map || points.length === 0 || !window.google?.maps) return;

    const g = window.google;
    const path = points.map((p) => ({ lat: p.latitude, lng: p.longitude }));

    if (polylineRef.current) polylineRef.current.setMap(null);
    polylineRef.current = new g.maps.Polyline({
      path,
      strokeColor: '#22d3ee',
      strokeOpacity: 0.9,
      strokeWeight: 3,
      map,
    });

    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    const dot = (position: google.maps.LatLngLiteral, color: string) =>
      new g.maps.Marker({
        position,
        map,
        icon: { path: g.maps.SymbolPath.CIRCLE, scale: 7, fillColor: color, fillOpacity: 1, strokeColor: '#0a1628', strokeWeight: 3 },
      });
    markersRef.current.push(dot(path[0], '#a855f7'));
    if (path.length > 1) markersRef.current.push(dot(path[path.length - 1], '#22d3ee'));

    const bounds = new g.maps.LatLngBounds();
    path.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds, 60);
  }, [mapReady, points]);

  // Draw saved-place pins
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.google?.maps) return;
    const g = window.google;

    placeMarkersRef.current.forEach((m) => m.setMap(null));
    placeMarkersRef.current = places.map((place) => {
      const marker = new g.maps.Marker({
        position: { lat: place.latitude, lng: place.longitude },
        map,
        icon: { path: g.maps.SymbolPath.CIRCLE, scale: 8, fillColor: '#fbbf24', fillOpacity: 1, strokeColor: '#0a1628', strokeWeight: 3 },
        title: place.name,
      });
      marker.addListener('click', () => {
        infoWindowRef.current?.setContent(
          `<div style="font:13px system-ui;color:#0a1628"><strong>${place.name}</strong>${place.notes ? `<br/>${place.notes}` : ''}</div>`,
        );
        infoWindowRef.current?.open(map, marker);
      });
      return marker;
    });
  }, [mapReady, places]);

  if (error) {
    return (
      <div className="w-full h-[60vh] min-h-[360px] grid place-items-center text-sm text-status-amber px-6 text-center">
        {error} — check the API key in Settings → Integrations.
      </div>
    );
  }

  return (
    <div className="relative w-full h-[60vh] min-h-[360px]">
      {/* Reported symptom: a black flash before the map appears. Real
          cause, not a bug exactly - Google's map script genuinely takes
          a moment to load and initialize, and this container rendered
          completely bare (no background, no indicator) during that
          gap, so it just looked like a blank/broken flash rather than
          a deliberate loading state. This overlay sits on top until
          mapReady flips true, then gets out of the way. */}
      {!mapReady && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-navy-900 rounded-2xl">
          <div className="flex flex-col items-center gap-2 text-ink-muted">
            <Loader2 size={22} className="animate-spin text-aurora-teal" />
            <span className="text-xs">Loading map…</span>
          </div>
        </div>
      )}
      <div ref={containerRef} data-testid={TRIPS.map} className="w-full h-full" />
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
    </div>
  );
}

/** MapLibre/OSM rendering of the trail + place pins — the default when
 * no Google Maps key is configured, and always used in the browser demo
 * (a real Google key can't safely ship in a public static build). */
function MapLibreTripsMap({ points, places }: { points: Point[]; places: Place[] }) {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const placeMarkersRef = useRef<maplibregl.Marker[]>([]);
  // A ref alone can't tell the offline controls that the map now
  // exists - mutating it doesn't re-render. This does.
  const [map, setMap] = useState<maplibregl.Map | null>(null);

  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE_URL,
      center: [-1.446, 55.011],
      zoom: 5,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
    mapRef.current = map;
    setMap(map);
    return () => {
      map.remove();
      mapRef.current = null;
      setMap(null);
    };
  }, []);

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

      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      const mk = (lngLat: [number, number], color: string) => {
        const el = document.createElement('div');
        el.style.cssText = `width:14px;height:14px;border-radius:9999px;background:${color};box-shadow:0 0 0 3px rgba(10,22,40,0.7),0 0 12px ${color};`;
        markersRef.current.push(new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map));
      };
      mk(coords[0], '#a855f7');
      if (coords.length > 1) mk(coords[coords.length - 1], '#22d3ee');

      const b = new maplibregl.LngLatBounds(coords[0], coords[0]);
      coords.forEach((c) => b.extend(c));
      map.fitBounds(b, { padding: 60, maxZoom: 13, duration: 600 });
    };

    if (map.isStyleLoaded()) draw();
    else map.once('load', draw);
  }, [points]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const draw = () => {
      placeMarkersRef.current.forEach((m) => m.remove());
      placeMarkersRef.current = [];
      places.forEach((place) => {
        const el = document.createElement('div');
        el.style.cssText =
          'width:16px;height:16px;border-radius:4px;transform:rotate(45deg);background:#fbbf24;' +
          'box-shadow:0 0 0 3px rgba(10,22,40,0.7),0 0 10px rgba(251,191,36,0.6);cursor:pointer;';
        const popup = new maplibregl.Popup({ offset: 14, closeButton: false }).setText(
          place.notes ? `${place.name} — ${place.notes}` : place.name,
        );
        placeMarkersRef.current.push(
          new maplibregl.Marker({ element: el }).setLngLat([place.longitude, place.latitude]).setPopup(popup).addTo(map),
        );
      });
    };

    if (map.isStyleLoaded()) draw();
    else map.once('load', draw);
  }, [places]);

  return (
    <div className="relative w-full h-[60vh] min-h-[360px]">
      <div data-testid={TRIPS.map} ref={mapContainerRef} className="w-full h-full" />
      <MapOfflineControls map={map} />
    </div>
  );
}

/** A detected stay that hasn't been named yet — the "name this stop" card. */
function CandidateCard({ candidate, onSaved }: { candidate: PlaceCandidate; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');

  const save = useMutation({
    mutationFn: () =>
      api.createPlace({
        name: name.trim() || 'Unnamed stop',
        notes: notes.trim() || undefined,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        arrived_at: candidate.arrived_at,
        departed_at: candidate.departed_at,
      }),
    onSuccess: () => {
      toast.success('Place saved');
      onSaved();
    },
    onError: () => toast.error('Could not save place'),
  });

  const hours = Math.max(0, Math.round((candidate.departed_at - candidate.arrived_at) / 3600));

  return (
    <div className="rounded-2xl p-4 bg-aurora-purple/[0.05] ring-1 ring-inset ring-aurora-purple/25">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-ink-soft">
          Parked here {fmtDay(candidate.arrived_at)} for about {hours < 1 ? '<1' : hours}h
        </div>
        <span className="text-[11px] text-ink-faint num">{candidate.point_count} fixes</span>
      </div>
      <div className="mt-3 flex flex-col sm:flex-row gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name this place…"
          className="flex-1 rounded-lg px-3 py-2 text-sm bg-ink/[0.06] border border-ink/10 outline-none focus:border-aurora-teal/50"
        />
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          className="flex-1 rounded-lg px-3 py-2 text-sm bg-ink/[0.06] border border-ink/10 outline-none focus:border-aurora-teal/50"
        />
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending || !name.trim()}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium bg-aurora-teal/15 text-aurora-teal ring-1 ring-inset ring-aurora-teal/40 hover:bg-aurora-teal/20 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          <Check size={14} /> Save
        </button>
      </div>
    </div>
  );
}

/** A saved, named place — click the name or notes to edit either. */
function PlaceCard({ place }: { place: Place }) {
  const qc = useQueryClient();
  const [editingField, setEditingField] = useState<'name' | 'notes' | null>(null);
  const [draft, setDraft] = useState('');

  const update = useMutation({
    mutationFn: (patch: { name?: string; notes?: string }) => api.updatePlace(place.id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['places'] });
      setEditingField(null);
    },
    onError: () => toast.error('Could not save changes'),
  });

  const del = useMutation({
    mutationFn: () => api.deletePlace(place.id),
    onSuccess: () => {
      toast.success('Place removed');
      qc.invalidateQueries({ queryKey: ['places'] });
    },
    onError: () => toast.error('Could not remove place'),
  });

  const commit = (field: 'name' | 'notes') => {
    const value = draft.trim();
    if (field === 'name' && !value) { setEditingField(null); return; }
    update.mutate({ [field]: value } as { name?: string; notes?: string });
  };

  const dateLabel = place.departed_at
    ? `${fmtDay(place.arrived_at)}${fmtDay(place.departed_at) !== fmtDay(place.arrived_at) ? ` – ${fmtDay(place.departed_at)}` : ''}`
    : fmtDay(place.arrived_at);

  return (
    <div className="rounded-2xl p-4 bg-ink/[0.03] ring-1 ring-inset ring-ink/10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {editingField === 'name' ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commit('name')}
              onKeyDown={(e) => { if (e.key === 'Enter') commit('name'); if (e.key === 'Escape') setEditingField(null); }}
              className="w-full rounded-lg px-2 py-1 text-base font-semibold bg-ink/[0.06] border border-aurora-teal/50 outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => { setEditingField('name'); setDraft(place.name); }}
              title="Click to rename"
              className="text-base font-semibold truncate text-left hover:text-aurora-teal transition"
            >
              {place.name}
            </button>
          )}
          <div className="text-[11px] text-ink-faint num mt-0.5">{dateLabel}</div>
        </div>
        <button
          type="button"
          onClick={() => del.mutate()}
          disabled={del.isPending}
          aria-label={`Remove ${place.name}`}
          className="shrink-0 h-7 w-7 grid place-items-center rounded-lg text-ink-faint hover:text-status-red hover:bg-status-red/10 transition disabled:opacity-40"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {editingField === 'notes' ? (
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit('notes')}
          onKeyDown={(e) => { if (e.key === 'Escape') setEditingField(null); }}
          rows={2}
          className="mt-2 w-full rounded-lg px-2 py-1.5 text-sm bg-ink/[0.06] border border-aurora-teal/50 outline-none resize-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => { setEditingField('notes'); setDraft(place.notes ?? ''); }}
          className="mt-2 w-full text-left text-sm text-ink-muted hover:text-ink-soft transition"
        >
          {place.notes || 'Add a note…'}
        </button>
      )}
    </div>
  );
}

/**
 * Purges a stretch of breadcrumb history — for cleaning out a
 * known-bad run rather than living with it forever. The distance
 * calc's 20m noise floor only catches small parked-jitter noise; a
 * genuinely bad GPS fix (poor sky view in the first days after fitting
 * a new antenna, a cold-start position, etc.) can jump much further
 * than that and isn't something a floor can safely filter without also
 * eating real short drives.
 */
function CleanupTrailControl({ onDeleted }: { onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [cutoff, setCutoff] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });

  const del = useMutation({
    mutationFn: (after: number) => api.deleteLocationHistory({ after }),
    onSuccess: (res) => {
      toast.success(`Removed ${res.deleted} breadcrumb${res.deleted === 1 ? '' : 's'}`);
      setOpen(false);
      onDeleted();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Delete failed'),
  });

  const confirmAndDelete = () => {
    if (!window.confirm(`Permanently delete every breadcrumb from ${cutoff} onward? This can't be undone.`)) return;
    del.mutate(new Date(`${cutoff}T00:00:00`).getTime() / 1000);
  };

  // A dedicated, explicit path, not the backend's unbounded-delete
  // guard being quietly worked around - the API deliberately refuses a
  // truly empty delete call (no after/before at all) so an accidental
  // bug can never wipe the whole table. Passing after=0 (the Unix
  // epoch, 1970 - guaranteed to be before any real GPS fix this app
  // has ever logged) satisfies that check honestly while functionally
  // deleting everything, keeping the backend's safety guard fully
  // intact for the genuinely-empty case it exists to catch. Reported
  // need: after four rounds of filtering fixes, distance was still
  // "unrealistic" - rather than keep layering heuristics on data that
  // may itself be compromised, start clean and watch it accumulate
  // correctly going forward instead.
  const confirmAndDeleteAll = () => {
    if (!window.confirm('Permanently delete EVERY breadcrumb ever logged - the whole trail, all 19+ days? This can\'t be undone.')) return;
    del.mutate(0);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] text-ink-faint hover:text-ink-soft underline underline-offset-2 inline-flex items-center gap-1"
      >
        <Trash2 size={11} /> Clean up trail data
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-ink/[0.03] ring-1 ring-ink/10 px-3 py-2">
      <span className="text-[11px] text-ink-muted">Delete breadcrumbs from</span>
      <input
        type="date"
        value={cutoff}
        onChange={(e) => setCutoff(e.target.value)}
        className="rounded-lg bg-transparent ring-1 ring-ink/15 px-2 py-1 text-xs num"
      />
      <span className="text-[11px] text-ink-muted">onward</span>
      <button
        type="button"
        onClick={confirmAndDelete}
        disabled={del.isPending}
        className="rounded-full px-3 py-1 text-xs font-medium bg-red-500/15 text-red-300 ring-1 ring-red-500/30 hover:bg-red-500/25 disabled:opacity-40"
      >
        {del.isPending ? 'Deleting…' : 'Delete'}
      </button>
      <span className="text-ink-faint">|</span>
      <button
        type="button"
        onClick={confirmAndDeleteAll}
        disabled={del.isPending}
        className="rounded-full px-3 py-1 text-xs font-medium bg-red-500/25 text-red-200 ring-1 ring-red-500/40 hover:bg-red-500/35 disabled:opacity-40"
      >
        {del.isPending ? 'Deleting…' : 'Delete everything, start fresh'}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-ink-faint hover:text-ink-soft">
        cancel
      </button>
    </div>
  );
}

/** Marks where "this trip" begins.
 *
 * A MARKER, deliberately, not a delete. The original ask was to purge
 * points before a date - but that is irreversible, throws away the
 * travel history this screen exists to accumulate, and only works if
 * you think of it BEFORE setting off. The request came mid-trip, when
 * deleting "before today" would have lost the drive that started it.
 *
 * So: freely backdatable, and changeable afterwards. The data is
 * already recorded; this only chooses where to measure from. Forget to
 * set it before you leave and you can fix it when you get home.
 */
function TripStartControl({ startedAt, onChanged }: { startedAt: number | null; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // datetime-local wants a local-time string, not an ISO/UTC one.
  const toLocalInput = (epoch: number) => {
    const d = new Date(epoch * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const openPanel = () => {
    setValue(toLocalInput(startedAt ?? Date.now() / 1000));
    setError(null);
    setOpen(true);
  };

  const save = async (epoch: number | null) => {
    setBusy(true);
    setError(null);
    try {
      await api.setTripStart(epoch);
      onChanged();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" onClick={openPanel} className="text-xs text-aurora-teal hover:underline">
        {startedAt
          ? `Trip started ${new Date(startedAt * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} — change`
          : 'Start a new trip from a date…'}
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="text-xs text-ink-muted">
        Measure distance from this moment onwards. Nothing is deleted — set it to when you actually left,
        even if that was days ago.
      </div>
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-full rounded-lg bg-black/30 ring-1 ring-white/15 px-3 py-2 text-sm"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !value}
          onClick={() => save(new Date(value).getTime() / 1000)}
          className="rounded-full px-3 py-1.5 text-xs ring-1 ring-aurora-teal/40 text-aurora-teal disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Set trip start'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => save(Date.now() / 1000)}
          className="rounded-full px-3 py-1.5 text-xs ring-1 ring-white/15 text-ink-muted disabled:opacity-40"
        >
          Start now
        </button>
        {startedAt && (
          <button
            type="button"
            disabled={busy}
            onClick={() => save(null)}
            className="rounded-full px-3 py-1.5 text-xs ring-1 ring-white/15 text-ink-muted disabled:opacity-40"
          >
            Clear (all time)
          </button>
        )}
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-ink-faint px-2">
          Cancel
        </button>
      </div>
      {error && <div className="text-xs text-status-amber">{error}</div>}
    </div>
  );
}

export function Trips() {
  const qc = useQueryClient();

  const { data } = useQuery({ queryKey: ['location-history'], queryFn: api.locationHistory });
  const points = useMemo<Point[]>(() => data?.points ?? [], [data]);

  // Distance comes from the BACKEND now, not from summing the points
  // above. Those are strided down to 2000 before being sent, and the
  // distance filters reason about gaps between consecutive points -
  // on the real 12k-point table the decimated trail caught only 160
  // bad segments where full resolution caught 3711, reading 403.94mi
  // against 366.59mi. The trail here is still what gets DRAWN; it just
  // no longer decides the number.
  const [allTime, setAllTime] = useState(false);
  const statsQuery = useQuery({
    queryKey: ['trip-stats', allTime],
    queryFn: () => api.tripStats({ allTime }),
  });
  const remote = statsQuery.data;

  const placesQuery = useQuery({ queryKey: ['places'], queryFn: api.places });
  const places = useMemo<Place[]>(() => placesQuery.data?.places ?? [], [placesQuery.data]);

  const candidatesQuery = useQuery({ queryKey: ['places-detected'], queryFn: api.detectedPlaces, refetchInterval: 60_000 });
  const candidates = useMemo<PlaceCandidate[]>(() => candidatesQuery.data?.candidates ?? [], [candidatesQuery.data]);

  // A real Google key can't safely ship in the public static demo build,
  // so the demo always uses the built-in MapLibre/OSM map regardless of
  // this setting.
  const cfg = useQuery({ queryKey: ['config-general'], queryFn: () => api.getConfig('general'), enabled: !isDemo });
  const mapsApiKey = String(cfg.data?.google_maps_api_key ?? '').trim();
  const useGoogle = !isDemo && mapsApiKey.length > 0;

  const stats = useMemo(() => {
    if (points.length < 1) return { distance: 0, days: 0, points: points.length, rejected: 0, byDay: [] as { day: string; metres: number }[] };
    let distance = 0;
    let rejected = 0;
    // Diagnostic breakdown, not a new filter - reported concern: 718mi
    // over 19 days still looked implausible against an own estimate of
    // well under that, and the map's pattern had changed shape (many
    // crossing lines between two fixed points, not a starburst around
    // one) - a genuinely different signature than the parked-jitter
    // cases the four checks below target. Rather than guess at a fifth
    // heuristic blind, surface which DAY the counted distance actually
    // landed on, so it can be checked against memory of when real
    // driving happened, instead of only ever seeing one opaque total.
    const dayTotals = new Map<string, number>();

    // A FOURTH failure mode, caught by none of the three checks below:
    // GPS drift that's fast enough to look like real movement to the
    // backend's own logging rule (>=50m within a few minutes, so it
    // logs via the movement trigger, not the 600s keepalive), but
    // isn't fast enough to trip the 60 m/s teleport ceiling and never
    // gets close to the keepalive interval either - it's simply
    // invisible to every existing filter. Reported case: a "starburst"
    // on the map, many short lines radiating out from and back to one
    // spot near home, 3802mi over 19 days for a van used twice. The
    // tell is the RETURN, not any single segment's speed or size - a
    // real trip doesn't usually snap back to within a stone's throw of
    // where it started a few minutes later; parked GPS jitter wobbling
    // around a stable position does exactly that, repeatedly.
    //
    // CORRECTED (real bug, not a guess - reproduced with an actual
    // drive's own logged data): the first version compared each point
    // against EVERYWHERE in the last 15 minutes, with no lower bound.
    // For genuine continuous driving, consecutive breadcrumbs are only
    // ~50-150m apart by construction (that's the movement-trigger
    // threshold) - so on any road with real curvature (which is all of
    // them), normal forward progress constantly looks like "returning
    // near somewhere recent" purely because that's how closely-spaced
    // route points naturally sit relative to each other. Worse, a
    // wrongly-rejected point still got added to the comparison pool,
    // so one false positive cascaded into rejecting most of what
    // followed - reported case: a genuine ~14.5mi drive read as 1.24mi,
    // 358 of 400 points rejected.
    //
    // Fix: only compare against points from AT LEAST
    // MIN_LOOKBACK_SECONDS ago, not the immediate recent past. A point
    // being near something from 3+ minutes ago is a real, specific
    // signal of backtracking or parked drift; a point being near
    // something from 10 seconds ago is just normal route density, not
    // evidence of anything. Verified with a synthetic test before
    // shipping this time, not trust-the-logic-alone: simulated both a
    // continuous curving drive and the original starburst pattern.
    // With no lower bound (the bug), the real drive lost 84% of its
    // distance to false rejections. With a 120s minimum, false
    // rejections on the real drive drop to zero, while the starburst
    // is caught exactly as effectively as before (unaffected, since
    // its drift-and-return cycles are naturally spaced well past 120s
    // apart anyway).
    //
    // Sliding window: remember where the trail's been over the last
    // RECENT_WINDOW_SECONDS. If a new point lands within
    // RETURN_THRESHOLD_METRES of anywhere visited between
    // MIN_LOOKBACK_SECONDS and RECENT_WINDOW_SECONDS ago, the
    // intervening "trip" reads as a round-trip back to roughly the
    // same spot - treat it as drift, not distance covered. Recent
    // history keeps every point regardless of whether it counted, so
    // later points can still detect "we're back near here" even
    // through a run of already-rejected drift.
    //
    // Known, accepted trade-off: a genuine short there-and-back errand
    // (drive somewhere close, park briefly, come straight home) inside
    // the same window would also get excluded. Rare for how this van's
    // actually used, and a small undercount on that rare case is a
    // clearly better trade than the alternative - reported case was
    // thousands of fake miles radiating from one real location.
    const RECENT_WINDOW_SECONDS = 15 * 60;
    const MIN_LOOKBACK_SECONDS = 120;
    const RETURN_THRESHOLD_METRES = 150;
    const recentPoints: { point: Point; timestamp: number }[] = [];

    for (let i = 1; i < points.length; i++) {
      const segment = haversineMetres(points[i - 1], points[i]);
      // Noise floor. A point gets logged either because the van moved
      // >=50m, or just because 10 minutes passed with the van parked
      // (location_service.py's HISTORY_MIN_INTERVAL_SECONDS keepalive,
      // so long stationary spells still get occasional breadcrumbs).
      // In the parked case, "moved" is pure GPS jitter, not real
      // distance - and summed over weeks of sitting still, that noise
      // adds up to a genuinely enormous fake trip total (reported: an
      // unmoved van reading 15,201km). A real movement-triggered
      // segment is always >=50m by construction, so filtering anything
      // under 20m can only ever drop jitter, never real driving.
      if (segment < 20) continue;

      // Speed sanity check. This is a DIFFERENT failure mode than the
      // floor above: a real GPS receiver occasionally reports one badly
      // wrong "teleport" fix (momentary loss of lock returning a stale
      // or corrupted position) - a single such point creates two huge
      // segments (jump out, jump back) that can dwarf a genuine drive.
      // Reported case: 16 real miles logged as 1850. A distance floor
      // can't catch this (the jump is large, not small noise) - but no
      // van does hundreds of mph between two breadcrumb points a few
      // seconds apart, so implied speed is the tell regardless of how
      // big the jump is. 60 m/s (~134mph) is a generous ceiling, well
      // above anything a real van does, with margin for GPS timestamp
      // imprecision.
      const elapsed = points[i].timestamp - points[i - 1].timestamp;
      if (elapsed <= 0 || segment / elapsed > 60) {
        rejected += 1;
        continue;
      }

      // A THIRD failure mode, caught neither by the floor nor the
      // teleport check: slow GPS drift while genuinely parked. Reported
      // case: 386 teleport jumps correctly excluded, trail still read
      // 2017mi over 18 days for a van that mostly sat still around
      // Northumberland. Drift that's, say, 150m over several minutes
      // implies under 1 m/s - nowhere near the 60 m/s teleport
      // threshold, so it sailed straight through, and summed across
      // ~2000 points over 18 days that kind of "plausible-looking slow
      // creep" is exactly what adds up to thousands of fake miles.
      //
      // The fix uses the backend's own logging rule against itself:
      // set_from_gps only logs a point at >=HISTORY_MIN_INTERVAL_SECONDS
      // (600s) *purely because the van hasn't moved >=50m* - if it had,
      // an earlier movement-triggered point would have fired well
      // before 600s elapsed at any real driving speed. So a segment
      // spanning close to (or beyond) that interval is, by the shape of
      // the logging system itself, one where genuine movement was under
      // 50m - meaning any larger distance it reports is GPS drift, not
      // travel, no matter how slow and "plausible" the implied speed
      // looks. Reuse the same 20m floor for these, not the looser
      // 60 m/s ceiling meant for short, fast segments.
      //
      // Known, accepted trade-off: a genuine multi-mile drive through a
      // long total GPS blackout (a long tunnel, dense forest) covering
      // real ground in one gap would also get excluded here, since its
      // average speed is usually well under the 60 m/s teleport
      // threshold. That's a real but rare case for how this van's
      // actually used (short local trips, not sustained motorway
      // driving through dead zones) - worth being honest about rather
      // than hiding, but a slight undercount on a rare edge case is a
      // clearly better trade than the alternative: reported case was
      // 2017mi over 18 days of mostly sitting still in Northumberland.
      const KEEPALIVE_INTERVAL_S = 600; // location_service.py: HISTORY_MIN_INTERVAL_SECONDS
      if (elapsed >= KEEPALIVE_INTERVAL_S * 0.9) {
        rejected += 1;
        continue;
      }

      // Drop old entries outside the recent window before checking -
      // "recently" should mean recently, not "at any point in this
      // entire multi-week trail".
      while (recentPoints.length && points[i].timestamp - recentPoints[0].timestamp > RECENT_WINDOW_SECONDS) {
        recentPoints.shift();
      }
      const returnedNearby = recentPoints.some(
        (rp) => points[i].timestamp - rp.timestamp >= MIN_LOOKBACK_SECONDS && haversineMetres(rp.point, points[i]) < RETURN_THRESHOLD_METRES,
      );
      recentPoints.push({ point: points[i], timestamp: points[i].timestamp });
      if (returnedNearby) {
        rejected += 1;
        continue;
      }

      distance += segment;
      const dayKey = new Date(points[i].timestamp * 1000).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
      dayTotals.set(dayKey, (dayTotals.get(dayKey) ?? 0) + segment);
    }
    const spanDays = (points[points.length - 1].timestamp - points[0].timestamp) / 86400;
    const byDay = Array.from(dayTotals.entries())
      .map(([day, metres]) => ({ day, metres }))
      .sort((a, b) => b.metres - a.metres);
    return { distance, days: Math.max(1, Math.ceil(spanDays || 0)), points: points.length, rejected, byDay };
  }, [points]);

  const empty = points.length === 0;
  const refreshPlaces = () => {
    qc.invalidateQueries({ queryKey: ['places'] });
    qc.invalidateQueries({ queryKey: ['places-detected'] });
  };

  return (
    <div data-testid={TRIPS.root} className="mx-auto max-w-[1500px] px-4 sm:px-6 lg:px-10 py-6 lg:py-10">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-ink-muted">Trips</div>
          <h1 className="text-3xl md:text-5xl font-semibold tracking-tight mt-1">
            Where the van has <span className="text-aurora-teal">been</span>
          </h1>
          <div className="text-sm text-ink-muted mt-2">Your trail, recorded from GPS as you go. The start of your trips &amp; memories log.</div>
          {/* ONLY the trip control here. The delete control used to sit
              directly beneath it, which put a red "Delete everything,
              start fresh" button immediately below a link reading
              "Start a new trip from a date" - two adjacent controls
              with opposite consequences, one recoverable and one not.
              Moved to the bottom of the page, away from anything
              routine. */}
          <div className="mt-3">
            <TripStartControl
              startedAt={remote?.trip_started_at ?? null}
              onChanged={() => qc.invalidateQueries({ queryKey: ['trip-stats'] })}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Only offered when a marker exists - a toggle between two
              identical numbers would be noise. */}
          {remote?.trip_started_at != null && (
            <button
              type="button"
              onClick={() => setAllTime((v) => !v)}
              className="rounded-full px-3 py-1 text-[11px] uppercase tracking-wider ring-1 ring-white/15 text-ink-muted"
            >
              {allTime ? 'All time' : 'This trip'}
            </button>
          )}
          <StatusPill tone={empty ? 'slate' : 'teal'}>{empty ? 'NO TRAIL YET' : `${remote?.points ?? stats.points} POINTS`}</StatusPill>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4 lg:gap-6">
        <GlassCard className="col-span-6 md:col-span-4 p-6">
          <CardHeader label="Distance travelled" hint="along the trail" right={<Route size={16} className="text-aurora-teal" />} />
          {/* Was wrapping mid-number on a phone - "366.59" on one line and
              a clipped "mi" on the next - because a 4xl number in a
              6-of-12 column has nowhere to go. Scales with the
              breakpoint and refuses to wrap. */}
          <div className="num text-2xl sm:text-3xl lg:text-4xl font-semibold whitespace-nowrap">{empty ? DASH : fmtDistance(remote?.distance_metres ?? stats.distance)}</div>
          </GlassCard>
        <GlassCard className="col-span-6 md:col-span-4 p-6">
          <CardHeader label="Days logged" hint="first fix to now" right={<CalendarDays size={16} className="text-aurora-teal" />} />
          <div className="num text-4xl font-semibold">{empty ? DASH : (remote?.days ?? stats.days)}</div>
        </GlassCard>
        <GlassCard className="col-span-12 md:col-span-4 p-6">
          <CardHeader label="Breadcrumbs" hint="GPS points saved" right={<MapPin size={16} className="text-aurora-teal" />} />
          <div className="num text-4xl font-semibold">{stats.points}</div>
        </GlassCard>

        <GlassCard className="col-span-12 p-0 overflow-hidden">
          {useGoogle ? (
            <GoogleTripsMap points={points} places={places} apiKey={mapsApiKey} />
          ) : (
            <MapLibreTripsMap points={points} places={places} />
          )}
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

        <GlassCard className="col-span-12 p-6" data-testid={TRIPS.places}>
          <CardHeader
            label="Places & journal"
            hint={places.length ? `${places.length} saved` : undefined}
            right={<BookOpen size={16} className="text-aurora-teal" />}
          />

          {candidates.length > 0 && (
            <div className="mt-4 space-y-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-ink-faint">New stops to name</div>
              {candidates.map((c) => (
                <CandidateCard key={`${c.latitude}-${c.arrived_at}`} candidate={c} onSaved={refreshPlaces} />
              ))}
            </div>
          )}

          <div className={candidates.length > 0 ? 'mt-6' : 'mt-4'}>
            {places.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {places.map((p) => (
                  <PlaceCard key={p.id} place={p} />
                ))}
              </div>
            ) : candidates.length === 0 ? (
              <div className="text-sm text-ink-muted">
                Once the van's parked somewhere for a while (25+ minutes), it'll show up here to name and journal.
              </div>
            ) : null}
          </div>
        </GlassCard>
      </div>

      {/* Destructive, so it lives at the very bottom, visually quiet,
          and nowhere near the trip controls at the top. Deleting
          breadcrumbs is for clearing genuinely bad data - it is NOT
          how you start a new trip, and it must not look like it is. */}
      <div className="pt-2 opacity-70">
        <CleanupTrailControl onDeleted={() => {
          qc.invalidateQueries({ queryKey: ['location-history'] });
          qc.invalidateQueries({ queryKey: ['trip-stats'] });
        }} />
      </div>
    </div>
  );
}
