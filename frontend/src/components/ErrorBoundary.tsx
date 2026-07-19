import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Without this, any uncaught render error unmounts the whole React tree
 * and leaves nothing but the page background — which looks identical to
 * "the app is broken" even when only one page is at fault. Keeping the
 * failure contained means the rest of the dashboard (and crucially the
 * nav, so you can get back out) keeps working.
 *
 * The most likely real-world trigger is a stale service-worker cache
 * serving old JavaScript against a newer backend response shape.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Uncaught error in component tree:", error, info.componentStack);
  }

  private reloadFresh = async () => {
    // A stale cached bundle is the most common cause here, so offer a
    // reload that actually clears it rather than a plain refresh that
    // would just serve the same broken JavaScript again.
    try {
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((r) => r.unregister()));
      }
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {
      // Best effort — reload regardless.
    }
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="rounded-xl2 bg-surface-card p-6">
        <h2 className="font-display text-base font-semibold text-alert">This page hit an error</h2>
        <p className="mt-2 text-sm text-text-secondary">
          The rest of the dashboard is still working — use the menu to go elsewhere. If this started after an update,
          the app may be running a cached older version.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-surface-raised p-3 font-mono text-xs text-text-muted">
          {this.state.error.message}
        </pre>
        <button
          onClick={this.reloadFresh}
          className="mt-4 rounded-lg bg-solar px-4 py-2 text-sm font-semibold text-black transition-all duration-150 hover:opacity-90 active:scale-95"
        >
          Clear cache &amp; reload
        </button>
      </div>
    );
  }
}
