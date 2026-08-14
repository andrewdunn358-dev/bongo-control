import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Radio as RadioIcon, Search, Play, Pause, Square, Music2, Volume2, VolumeX, Star } from 'lucide-react';
import { GlassCard } from '@/components/primitives/GlassCard';
import { StatusPill } from '@/components/primitives/StatusPill';
import { api } from '@/lib/api';
import { isDemo } from '@/lib/demo';
import { RADIO } from '@/constants/testIds';
import type { RadioStation } from '@/lib/types';

/**
 * Browse + play UK internet radio stations - "a bit like our own DAB
 * radio", as originally asked for. Stations come from the Radio
 * Browser public directory (radio_directory_service.py); playback
 * itself reuses the exact same internet_radio_service play/pause/stop
 * endpoints already built for Battery Bar, so there's only ever one
 * playback path in this app, not two competing ones.
 *
 * DEMO MODE IS THE EXCEPTION: the demo build has no backend at all
 * (see demo.ts) - there's no mpv on a Pi to control, so the API calls
 * above would just return canned JSON with nothing actually audible.
 * A radio feature that shows a fake "PLAYING" pill but stays silent is
 * a worse demo than no radio feature at all - people testing it are
 * specifically trying to hear it work. So in demo mode only, this
 * plays a real stream directly in the browser via a plain <audio>
 * element instead of calling the (nonexistent) backend. <audio src>
 * doesn't need CORS the way fetch() would - it's the same mechanism
 * an <img> tag uses cross-origin, so this works with no server-side
 * involvement at all.
 */
/**
 * A single station row - reused for both the Favourites section and
 * the search results list, so the two never visually or behaviourally
 * drift apart. A plain <button> can't be used for the whole row like
 * the original single-list version did, once a favourite star needs
 * its own click target inside it - nesting a <button> inside another
 * <button> is invalid HTML and browsers silently mishandle the click
 * routing. This uses a <div role="button"> with its own onClick +
 * onKeyDown (Enter/Space) for play, matching a real button's keyboard
 * behaviour, and a genuine separate <button> for the star with
 * stopPropagation() so tapping it doesn't also trigger playback.
 */
function StationRow({
  station,
  isCurrent,
  playing,
  onPlay,
  playDisabled,
  isFavorite,
  onToggleFavorite,
}: {
  station: RadioStation;
  isCurrent: boolean;
  playing: boolean;
  onPlay: () => void;
  playDisabled: boolean;
  isFavorite: boolean;
  onToggleFavorite: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={playDisabled ? -1 : 0}
      onClick={() => !playDisabled && onPlay()}
      onKeyDown={(e) => {
        if (!playDisabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onPlay();
        }
      }}
      aria-disabled={playDisabled}
      className={`w-full flex items-center gap-3 py-3 px-2 text-left rounded-lg transition-colors cursor-pointer ${
        isCurrent ? 'bg-aurora-teal/10' : 'hover:bg-ink/[0.03]'
      } ${playDisabled ? 'opacity-60 pointer-events-none' : ''}`}
    >
      <div className="h-10 w-10 rounded-full grid place-items-center ring-1 ring-ink/10 bg-ink/[0.04] shrink-0 overflow-hidden">
        {station.favicon ? (
          <img src={station.favicon} alt="" className="h-full w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        ) : (
          <RadioIcon size={16} className="text-ink-faint" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-medium truncate ${isCurrent ? 'text-aurora-teal' : ''}`}>{station.name}</div>
        <div className="text-[11px] text-ink-faint truncate mt-0.5">
          {[station.tags.slice(0, 3).join(', '), station.bitrate ? `${station.bitrate}kbps` : null, station.codec]
            .filter(Boolean)
            .join(' · ') || 'UK radio'}
        </div>
      </div>
      {isCurrent && playing && <StatusPill tone="teal" className="shrink-0">PLAYING</StatusPill>}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
        aria-label={isFavorite ? `Remove ${station.name} from favourites` : `Add ${station.name} to favourites`}
        className="shrink-0 p-1 -m-1 rounded-full hover:bg-ink/[0.06]"
      >
        <Star size={16} className={isFavorite ? 'fill-status-amber text-status-amber' : 'text-ink-faint'} />
      </button>
      {!(isCurrent && playing) && <Play size={16} className="text-ink-faint shrink-0" />}
    </div>
  );
}

export function RadioPage() {
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const audioRef = useRef<HTMLAudioElement>(null);
  const [demoPlaying, setDemoPlaying] = useState(false);
  const [demoUrl, setDemoUrl] = useState<string | null>(null);
  const [demoVolume, setDemoVolume] = useState(100);
  // Local display value while dragging, seeded from the server's own
  // status once loaded - shows instantly as the slider moves without
  // waiting for a round trip per pixel; null means "not currently
  // being dragged, just show whatever status.data.volume says".
  const [draggingVolume, setDraggingVolume] = useState<number | null>(null);
  const volumeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [demoFavorites, setDemoFavorites] = useState<RadioStation[]>([]);

  const stations = useQuery({
    queryKey: ['radio-directory', searchTerm],
    queryFn: () => api.radioDirectorySearch(searchTerm || undefined),
  });

  const favorites = useQuery({
    queryKey: ['radio-favorites'],
    queryFn: api.radioFavorites,
    enabled: !isDemo, // demo mode uses demoFavorites (in-memory, not persisted) - matches the play/pause/stop demo pattern
  });
  const favoriteList = isDemo ? demoFavorites : favorites.data ?? [];
  const favoriteUrls = new Set(favoriteList.map((f) => f.url));

  const toggleFavorite = useMutation({
    mutationFn: async (station: RadioStation) => {
      const isFav = favoriteUrls.has(station.url);
      if (isDemo) {
        setDemoFavorites((prev) => (isFav ? prev.filter((f) => f.url !== station.url) : [...prev, station]));
        return;
      }
      return isFav ? api.radioRemoveFavorite(station.url) : api.radioAddFavorite(station);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['radio-favorites'] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not update favourites'),
  });

  const status = useQuery({
    queryKey: ['internet-radio-status'],
    queryFn: api.internetRadioStatus,
    refetchInterval: isDemo ? false : 5000, // demo status is local audio-element state, not worth polling
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['internet-radio-status'] });

  const play = useMutation({
    mutationFn: async (station: RadioStation) => {
      if (station.uuid) api.radioDirectoryClick(station.uuid).catch(() => {}); // courtesy stat, never blocks playback
      if (isDemo) {
        const el = audioRef.current;
        if (!el) return;
        el.src = station.url;
        await el.play(); // a direct result of the click that triggered this - satisfies browser autoplay policy
        setDemoUrl(station.url); // only after play() actually resolves - a failed station shouldn't look "selected"
        return;
      }
      return api.internetRadioPlay(station.url);
    },
    onSuccess: invalidate,
    onError: (e) => toast.error(isDemo ? "Couldn't play that station's demo stream - try another one" : e instanceof Error ? e.message : 'Could not play that station'),
  });
  const pause = useMutation({
    mutationFn: async () => (isDemo ? audioRef.current?.pause() : api.internetRadioPause()),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not pause'),
  });
  const resume = useMutation({
    mutationFn: async () => (isDemo ? audioRef.current?.play() : api.internetRadioResume()),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not resume'),
  });
  const stop = useMutation({
    mutationFn: async () => {
      if (isDemo) {
        const el = audioRef.current;
        if (el) {
          el.pause();
          el.removeAttribute('src');
        }
        setDemoUrl(null);
        return;
      }
      return api.internetRadioStop();
    },
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not stop'),
  });

  const setVolume = useMutation({
    mutationFn: (level: number) => api.internetRadioSetVolume(level),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not set volume'),
  });

  // Debounced, not fired on every slider pixel - dragging updates the
  // displayed number instantly (draggingVolume) but only actually
  // calls the API ~200ms after movement stops, same "don't spam a
  // request per pixel" reasoning as any other live slider.
  const handleVolumeChange = (level: number) => {
    setDraggingVolume(level);
    if (isDemo) {
      setDemoVolume(level);
      if (audioRef.current) audioRef.current.volume = level / 100;
      return;
    }
    if (volumeDebounceRef.current) clearTimeout(volumeDebounceRef.current);
    volumeDebounceRef.current = setTimeout(() => {
      setVolume.mutate(level);
      setDraggingVolume(null);
    }, 200);
  };

  const playing = isDemo ? demoPlaying : status.data?.playing ?? false;
  const running = isDemo ? demoUrl !== null : status.data?.running ?? false;
  const currentUrl = isDemo ? demoUrl : status.data?.stream_url;
  const currentVolume = draggingVolume ?? (isDemo ? demoVolume : status.data?.volume ?? 100);

  return (
    <div data-testid={RADIO.root} className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 py-6 lg:py-10">
      {isDemo && (
        <audio
          ref={audioRef}
          onPlay={() => setDemoPlaying(true)}
          onPause={() => setDemoPlaying(false)}
          onEnded={() => { setDemoPlaying(false); setDemoUrl(null); }}
          onError={() => { setDemoPlaying(false); toast.error("Couldn't load that station's stream - try another one"); }}
          className="hidden"
        />
      )}
      <div className="mb-6">
        <div className="text-[11px] uppercase tracking-[0.24em] text-ink-muted">Radio</div>
        <h1 className="text-3xl md:text-5xl font-semibold tracking-tight mt-1">
          On the <span className="text-aurora-teal">dial</span>
        </h1>
        <div className="text-sm text-ink-muted mt-2 max-w-2xl">
          UK internet radio, browsable like a DAB set — tap a station to play it through the van speaker. Pauses
          automatically whenever you use a voice command, then picks back up.
        </div>
      </div>

      {/* Now playing / transport controls */}
      <GlassCard className="p-5 mb-5" data-testid={RADIO.player} glow={playing ? 'teal' : undefined}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="h-12 w-12 rounded-2xl grid place-items-center ring-1 ring-inset bg-aurora-teal/10 ring-aurora-teal/30 shrink-0">
              <Music2 size={20} className="text-aurora-teal" />
            </div>
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-widest text-ink-muted">Now playing</div>
              <div className="text-sm font-medium truncate mt-0.5">
                {currentUrl ? stations.data?.stations.find((s) => s.url === currentUrl)?.name || 'Streaming' : 'Nothing playing'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <StatusPill tone={playing ? 'teal' : 'slate'} dot={playing}>
              {playing ? 'PLAYING' : running ? 'PAUSED' : 'STOPPED'}
            </StatusPill>
            {playing ? (
              <button
                type="button"
                onClick={() => pause.mutate()}
                className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm bg-aurora-teal text-navy-900 font-semibold hover:brightness-110"
              >
                <Pause size={14} /> Pause
              </button>
            ) : running ? (
              <button
                type="button"
                onClick={() => resume.mutate()}
                className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm bg-aurora-teal text-navy-900 font-semibold hover:brightness-110"
              >
                <Play size={14} /> Resume
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => stop.mutate()}
              disabled={!running}
              className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm bg-ink/[0.06] ring-1 ring-ink/10 hover:bg-ink/[0.1] disabled:opacity-40"
            >
              <Square size={14} /> Stop
            </button>
          </div>
        </div>

        {/* Volume - a real, persistent level (survives a restart -
            see internet_radio_service._configured_volume()), separate
            from ducking, which only ever pauses the stream outright
            for a voice interaction, never lowers it. Works regardless
            of playing/running state - sets what the NEXT play() (or
            the already-running stream) uses, same as adjusting a
            physical radio's volume knob whether or not it's on. */}
        <div className="flex items-center gap-3 mt-4 pt-4 border-t border-ink/10">
          {currentVolume === 0 ? (
            <VolumeX size={16} className="text-ink-faint shrink-0" />
          ) : (
            <Volume2 size={16} className="text-ink-faint shrink-0" />
          )}
          <input
            type="range"
            min={0}
            max={100}
            value={currentVolume}
            onChange={(e) => handleVolumeChange(Number(e.target.value))}
            className="flex-1 accent-aurora-teal"
            aria-label="Radio volume"
          />
          <span className="text-xs text-ink-muted w-9 text-right tabular-nums">{currentVolume}%</span>
        </div>
      </GlassCard>

      {/* Favourites - always visible regardless of search state, so
          getting back to a saved station never needs re-searching
          through however many results came back. Hidden entirely when
          there are none yet, rather than showing an empty placeholder
          card for a feature nobody's used. */}
      {favoriteList.length > 0 && (
        <div className="mb-5">
          <div className="text-xs uppercase tracking-widest text-ink-muted mb-2 flex items-center gap-1.5">
            <Star size={12} className="fill-status-amber text-status-amber" /> Favourites
          </div>
          <GlassCard className="p-4" data-testid={RADIO.favorites}>
            <div className="divide-y divide-ink/5">
              {favoriteList.map((station) => (
                <StationRow
                  key={station.uuid ?? station.url}
                  station={station}
                  isCurrent={currentUrl === station.url}
                  playing={playing}
                  onPlay={() => play.mutate(station)}
                  playDisabled={play.isPending}
                  isFavorite
                  onToggleFavorite={() => toggleFavorite.mutate(station)}
                />
              ))}
            </div>
          </GlassCard>
        </div>
      )}

      {/* Search */}
      <div className="mb-5">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            data-testid={RADIO.searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setSearchTerm(query)}
            placeholder="Search stations (e.g. 'Capital', 'jazz', 'BBC')…"
            className="w-full rounded-xl bg-ink/[0.04] ring-1 ring-ink/10 focus:ring-aurora-teal/50 outline-none pl-9 pr-24 py-3 text-sm"
          />
          <button
            type="button"
            onClick={() => setSearchTerm(query)}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full px-3 py-1.5 text-xs font-medium bg-ink/[0.06] ring-1 ring-ink/10 hover:bg-ink/[0.1]"
          >
            Search
          </button>
        </div>
        {searchTerm && (
          <button
            type="button"
            onClick={() => { setQuery(''); setSearchTerm(''); }}
            className="text-xs text-ink-faint mt-2 hover:text-ink-soft"
          >
            Clear search, show popular UK stations
          </button>
        )}
      </div>

      {/* Station list */}
      <GlassCard className="p-4" data-testid={RADIO.stationList}>
        {stations.isLoading ? (
          <div className="text-sm text-ink-faint text-center py-8">Finding stations…</div>
        ) : stations.isError ? (
          <div className="text-sm text-status-amber text-center py-8">
            Couldn't reach the station directory — check the Pi has internet, then try again.
          </div>
        ) : !stations.data?.stations.length ? (
          <div className="text-sm text-ink-faint text-center py-8">No stations found{searchTerm ? ` for "${searchTerm}"` : ''}.</div>
        ) : (
          <div className="divide-y divide-ink/5">
            {stations.data.stations.map((station) => {
              const isCurrent = currentUrl === station.url;
              return (
                <StationRow
                  key={station.uuid ?? station.url}
                  station={station}
                  isCurrent={isCurrent}
                  playing={playing}
                  onPlay={() => play.mutate(station)}
                  playDisabled={play.isPending}
                  isFavorite={favoriteUrls.has(station.url)}
                  onToggleFavorite={() => toggleFavorite.mutate(station)}
                />
              );
            })}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
