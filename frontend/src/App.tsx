import { BrowserRouter, HashRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuroraBackground } from '@/components/primitives/AuroraBackground';
import { SplashScreen } from '@/components/SplashScreen';
import { NavShell } from '@/components/NavShell';
import { SimBanner } from '@/components/SimBanner';
import { UpdateBanner } from '@/components/UpdateBanner';
import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';
import { AppGate } from '@/components/AppGate';
import { useTelemetry } from '@/lib/telemetry';
import { useTheme } from '@/lib/theme';
import { isDemo } from '@/lib/demo';
import { Home } from '@/screens/Home';
import { Energy } from '@/screens/Energy';
import { Battery } from '@/screens/Battery';
import { Solar } from '@/screens/Solar';
import { Weather } from '@/screens/Weather';
import { Nearby } from '@/screens/Nearby';
import { Switches } from '@/screens/Switches';
import { CameraView } from '@/screens/Camera';
import { HistoryScreen } from '@/screens/History';
import { Settings } from '@/screens/Settings';

export function App() {
  const { connected } = useTelemetry();
  const { theme } = useTheme();
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
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/energy" element={<Energy />} />
              <Route path="/battery" element={<Battery />} />
              <Route path="/solar" element={<Solar />} />
              <Route path="/weather" element={<Weather />} />
              <Route path="/nearby" element={<Nearby />} />
              <Route path="/switches" element={<Switches />} />
              <Route path="/camera" element={<CameraView />} />
              <Route path="/history" element={<HistoryScreen />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </RouteErrorBoundary>
        </NavShell>
      </Router>
      </AppGate>
      <UpdateBanner />
      {isDemo && (
        <a
          href="https://github.com/andrewdunn358-dev/bongo-control"
          target="_blank"
          rel="noreferrer"
          className="fixed bottom-24 md:bottom-4 left-4 z-[55] inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-semibold bg-aurora-purple/20 ring-1 ring-inset ring-aurora-purple/50 text-aurora-purple backdrop-blur-md hover:bg-aurora-purple/30"
        >
          <span className="h-2 w-2 rounded-full bg-aurora-purple animate-pulse" />
          DEMO · simulated data · view source
        </a>
      )}
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
