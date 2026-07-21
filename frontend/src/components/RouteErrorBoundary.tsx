import { Component, type ErrorInfo, type ReactNode } from 'react';
import { GlassCard } from '@/components/primitives/GlassCard';

interface Props { children: ReactNode }
interface State { error: Error | null }

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[RouteErrorBoundary]', error, info);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-lg px-4 py-10">
        <GlassCard className="p-6">
          <div className="text-status-red text-sm font-semibold uppercase tracking-widest">Route error</div>
          <div className="mt-2 text-ink">{this.state.error.message || 'Something went wrong'}</div>
          <button
            className="mt-4 rounded-full px-3 py-1.5 text-sm bg-ink/5 ring-1 ring-inset ring-ink/10 text-ink-soft hover:bg-ink/10"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </GlassCard>
      </div>
    );
  }
}
