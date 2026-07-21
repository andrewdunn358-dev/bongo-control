import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import '@/App.css';
import { AuroraBackground } from '@/components/primitives/AuroraBackground';
import { NavShell } from '@/components/NavShell';
import { useTelemetry } from '@/lib/ws';
import { ThemeProvider } from '@/lib/theme';
import { Dashboard } from '@/screens/Dashboard';
import { SitRep } from '@/screens/SitRep';
import { NearbyPlaces } from '@/screens/NearbyPlaces';
import { Weather } from '@/screens/Weather';
import { CameraView } from '@/screens/Camera';
import { HistoryScreen } from '@/screens/History';
import { Settings } from '@/screens/Settings';

function App() {
  const telemetry = useTelemetry({ bufferSize: 90 });

  return (
    <ThemeProvider>
      <div className="App min-h-screen text-slate-100">
        <AuroraBackground />
        <BrowserRouter>
          <NavShell wsConnected={telemetry.connected}>
            <Routes>
              <Route path="/" element={<Dashboard telemetry={telemetry} />} />
              <Route path="/sitrep" element={<SitRep telemetry={telemetry} />} />
              <Route path="/nearby" element={<NearbyPlaces />} />
              <Route path="/weather" element={<Weather />} />
              <Route path="/camera" element={<CameraView />} />
              <Route path="/history" element={<HistoryScreen />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </NavShell>
        </BrowserRouter>
        <Toaster
          theme="dark"
          position="top-right"
          toastOptions={{
            style: {
              background: 'rgba(15, 41, 66, 0.85)',
              border: '1px solid rgba(34,211,238,0.25)',
              color: '#e6f0ff',
              backdropFilter: 'blur(14px)',
            },
          }}
        />
      </div>
    </ThemeProvider>
  );
}

export default App;
