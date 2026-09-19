import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/index.css';
// Widget styling is app-wide, not a cockpit's. Imported from the ENTRY
// on purpose: Vite chunks CSS along the JS import graph, so importing
// it only from the widget modules put it straight back into whichever
// lazy cockpit chunk happened to use them - which is the bug this is
// fixing. Measured, not assumed.
import '@/components/widgets/widgets.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import { App } from '@/App';
import { ThemeProvider } from '@/lib/theme';
import { adoptMoveParams } from '@/lib/connection';

// Arriving by a local/remote connection switch (lib/connection.ts): take
// over the login it carried, before anything checks for one.
adoptMoveParams();

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => {
        // Never retry auth/permission errors
        const status = (err as { status?: number })?.status;
        if (status === 401 || status === 403) return false;
        return count < 2;
      },
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <App />
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
