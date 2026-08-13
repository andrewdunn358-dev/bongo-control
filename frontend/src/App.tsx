import { lazy, Suspense } from 'react';
import { BrowserRouter, HashRouter, Route, Routes, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuroraBackground } from '@/components/primitives/AuroraBackground';
import { SplashScreen } from '@/components/SplashScreen';
import { NavShell } from '@/components/NavShell';
import { SimBanner } from '@/components/SimBanner';
import { UpdateBanner } from '@/components/UpdateBanner';
import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';
import { AppGate } from '@/components/AppGate';
import { useConnected } from '@/lib/telemetry';
import { useTheme } from '@/lib/theme';
import { useAutoLocate } from '@/lib/useAutoLocate';
import { isDemo } from '@/lib/demo';
import { Home } from '@/screens/Home';
import { Power } from '@/screens/Power';
import { Weather } from '@/screens/Weather';
import { Switches } from '@/screens/Switches';
import { Roof } from '@/screens/Roof';
import { CameraView } from '@/screens/Camera';
import { Settings } from '@/screens/Settings';

// Code-split the heavy screens so their large deps (MapLibre ~800 KB,
// Recharts ~536 KB) don't block the Home cockpit's first paint — they
// load on navigation instead. Big win on the old in-van tablet.
const Nearby = lazy(() => import('@/screens/Nearby').then((m) => ({ default: m.Nearby })));
const HistoryScreen = lazy(() => import('@/screens/History').then((m) => ({ default: m.HistoryScreen })));
const Trips = lazy(() => import('@/screens/Trips').then((m) => ({ default: m.Trips })));
const Coverage = lazy(() => import('@/screens/Coverage').then((m) => ({ default: m.Coverage })));
const Chat = lazy(() => import('@/screens/Chat').then((m) => ({ default: m.Chat })));
const Overview = lazy(() => import('@/screens/Overview').then((m) => ({ default: m.Overview })));
const RadioPage = lazy(() => import('@/screens/Radio').then((m) => ({ default: m.RadioPage })));

export function App() {
  const connected = useConnected();
  const { theme } = useTheme();
  useAutoLocate(); // silent GPS on load + every few minutes, when permitted
  // Hash routing in the static demo build so deep links work on any host
  // (e.g. a 20i subdomain) with no server-side rewrite rules.
  const Router = isDemo ? HashRouter : BrowserRouter;
  return (
    <>
      <SplashScreen />
      <AuroraBackground />
      <AppGate>
      <Router
        future={{
          // Opt in to the two v7 future flags — safe and silences the console.
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <NavShell wsConnected={connected}>
          <SimBanner />
          <RouteErrorBoundary>
            <Suspense fallback={<div className="p-10 text-sm text-ink-muted">Loading…</div>}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/power" element={<Power />} />
              {/* Redirects for the three pages Power replaced - cheap
                  insurance against a stale bookmark or PWA home-screen
                  shortcut landing on a route that no longer exists. */}
              <Route path="/energy" element={<Navigate to="/power" replace />} />
              <Route path="/battery" element={<Navigate to="/power" replace />} />
              <Route path="/solar" element={<Navigate to="/power" replace />} />
              <Route path="/weather" element={<Weather />} />
              <Route path="/nearby" element={<Nearby />} />
              <Route path="/coverage" element={<Coverage />} />
              <Route path="/switches" element={<Switches />} />
              <Route path="/roof" element={<Roof />} />
              <Route path="/camera" element={<CameraView />} />
              <Route path="/history" element={<HistoryScreen />} />
              <Route path="/trips" element={<Trips />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/overview" element={<Overview />} />
              <Route path="/radio" element={<RadioPage />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
            </Suspense>
          </RouteErrorBoundary>
        </NavShell>
      </Router>
      </AppGate>
      <UpdateBanner />
      <Toaster
        theme={theme}
        position="top-right"
        toastOptions={{
          style: {
            background: theme === 'light' ? 'rgba(255,255,255,0.95)' : 'rgba(15,41,66,0.9)',
            border: '1px solid rgba(34,211,238,0.3)',
            color: theme === 'light' ? '#0a1628' : '#e6f0ff',
            backdropFilter: 'blur(14px)',
          },
        }}
      />
    </>
  );
}
