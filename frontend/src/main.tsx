import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/index.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import { App } from '@/App';
import { ThemeProvider } from '@/lib/theme';

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
