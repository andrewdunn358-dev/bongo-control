import { Component, type ErrorInfo, type ReactNode } from 'react';
import { GlassCard } from '@/components/primitives/GlassCard';

interface Props { children: ReactNode }
interface State { error: Error | null }

// A page's code is loaded on demand. Over a flaky link (the MiFi tunnel)
// that fetch can time out, which shows up as "Failed to fetch dynamically
// imported module". The file is fine — a reload fetches it again — so do
// that automatically, at most once a minute so a real fault can't loop.
const CHUNK_ERROR = /dynamically imported module|Importing a module script failed|error loading dynamically imported/i;
const RELOAD_KEY = 'vanos-chunk-reload-at';

function shouldAutoReload(error: Error): boolean {
  if (!CHUNK_ERROR.test(error.message || '')) return false;
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  return true;
}

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[RouteErrorBoundary]', error, info);
    if (shouldAutoReload(error)) window.location.reload();
  }
  render() {
    if (!this.state.error) return this.props.children;
    const isChunk = CHUNK_ERROR.test(this.state.error.message || '');
    return (
      <div className="mx-auto max-w-lg px-4 py-10">
        <GlassCard className="p-6">
          <div className="text-status-red text-sm font-semibold uppercase tracking-widest">
            {isChunk ? 'Connection hiccup' : 'Route error'}
          </div>
          <div className="mt-2 text-ink">
            {isChunk
              ? 'This page didn’t finish downloading — the link to the van dropped for a moment.'
              : this.state.error.message || 'Something went wrong'}
          </div>
          <button
            className="mt-4 rounded-full px-3 py-1.5 text-sm bg-ink/5 ring-1 ring-inset ring-ink/10 text-ink-soft hover:bg-ink/10"
            onClick={() => (isChunk ? window.location.reload() : this.setState({ error: null }))}
          >
            {isChunk ? 'Reload' : 'Try again'}
          </button>
        </GlassCard>
      </div>
    );
  }
}
