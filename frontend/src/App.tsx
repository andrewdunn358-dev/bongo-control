import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuroraBackground } from '@/components/primitives/AuroraBackground';
import { NavShell } from '@/components/NavShell';
import { SimBanner } from '@/components/SimBanner';
import { UpdateBanner } from '@/components/UpdateBanner';
import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';
import { useTelemetry } from '@/lib/telemetry';
import { useTheme } from '@/lib/theme';
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
  return (
    <>
      <AuroraBackground />
      <BrowserRouter>
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
      </BrowserRouter>
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
