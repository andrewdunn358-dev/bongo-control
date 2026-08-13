import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Radio as RadioIcon, Search, Play, Pause, Square, Music2 } from 'lucide-react';
import { GlassCard } from '@/components/primitives/GlassCard';
import { StatusPill } from '@/components/primitives/StatusPill';
import { api } from '@/lib/api';
import { RADIO } from '@/constants/testIds';
import type { RadioStation } from '@/lib/types';

/**
 * Browse + play UK internet radio stations - "a bit like our own DAB
 * radio", as originally asked for. Stations come from the Radio
 * Browser public directory (radio_directory_service.py); playback
 * itself reuses the exact same internet_radio_service play/pause/stop
 * endpoints already built for Battery Bar, so there's only ever one
 * playback path in this app, not two competing ones.
 */
export function RadioPage() {
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const stations = useQuery({
    queryKey: ['radio-directory', searchTerm],
    queryFn: () => api.radioDirectorySearch(searchTerm || undefined),
  });

  const status = useQuery({
    queryKey: ['internet-radio-status'],
    queryFn: api.internetRadioStatus,
    refetchInterval: 5000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['internet-radio-status'] });

  const play = useMutation({
    mutationFn: (station: RadioStation) => {
      if (station.uuid) api.radioDirectoryClick(station.uuid).catch(() => {}); // courtesy stat, never blocks playback
      return api.internetRadioPlay(station.url);
    },
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not play that station'),
  });
  const pause = useMutation({ mutationFn: api.internetRadioPause, onSuccess: invalidate, onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not pause') });
  const resume = useMutation({ mutationFn: api.internetRadioResume, onSuccess: invalidate, onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not resume') });
  const stop = useMutation({ mutationFn: api.internetRadioStop, onSuccess: invalidate, onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not stop') });

  const playing = status.data?.playing ?? false;
  const running = status.data?.running ?? false;
  const currentUrl = status.data?.stream_url;

  return (
    <div data-testid={RADIO.root} className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 py-6 lg:py-10">
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
      </GlassCard>

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
                <button
                  key={station.uuid ?? station.url}
                  type="button"
                  onClick={() => play.mutate(station)}
                  disabled={play.isPending}
                  className={`w-full flex items-center gap-3 py-3 px-2 text-left rounded-lg transition-colors ${
                    isCurrent ? 'bg-aurora-teal/10' : 'hover:bg-ink/[0.03]'
                  } disabled:opacity-60`}
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
                  {isCurrent && playing ? (
                    <StatusPill tone="teal" className="shrink-0">PLAYING</StatusPill>
                  ) : (
                    <Play size={16} className="text-ink-faint shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
