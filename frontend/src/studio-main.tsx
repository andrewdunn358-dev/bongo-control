import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@/index.css';
import '@/components/widgets/widgets.css';
import { ThemeProvider } from '@/lib/theme';
import { Studio } from '@/screens/Studio';
import { startTelemetry } from '@/lib/telemetry';

/**
 * THE THEME STUDIO, ON ITS OWN.
 *
 * A SEPARATE PAGE, NOT PART OF THE VAN'S APP. It is built by its own
 * config (vite.studio.config.ts) into its own folder and uploaded to
 * the public site next to app.html; the Pi's image never contains it
 * and the app has no route to it. Authoring tools have no business on
 * a dashboard that drives relays.
 *
 * What it does share is the thing that matters: the widgets. It imports
 * them from this same source tree, so a design is drawn by the van's
 * own code and cannot drift from what the van shows.
 *
 * MemoryRouter because the widgets are links (a battery card opens the
 * Power page). In here those lead nowhere, which is right: this is a
 * picture of Home, not Home.
 */
// The widgets show the in-browser simulation, so a card reads like a
// real one instead of a row of dashes. Nothing is claimed to be live:
// there is no van behind this page.
startTelemetry();

const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <Studio />
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
