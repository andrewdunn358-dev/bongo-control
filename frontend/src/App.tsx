import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { TelemetryProvider } from "./context/TelemetryContext";
import { ThemeProvider } from "./context/ThemeContext";
import { LocationProvider } from "./context/LocationContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import UnlockScreen from "./components/UnlockScreen";
import AppLayout from "./components/Layout/AppLayout";
import ErrorBoundary from "./components/ErrorBoundary";
import UpdateBanner from "./components/UpdateBanner";
import MissionBriefModal from "./components/MissionBrief/MissionBriefModal";
import Home from "./pages/Home";
import Energy from "./pages/Energy";
import Battery from "./pages/Battery";
import Solar from "./pages/Solar";
import Nearby from "./pages/Nearby";
import Weather from "./pages/Weather";
import Camera from "./pages/Camera";
import Relays from "./pages/Relays";
import History from "./pages/History";
import SettingsLayout from "./pages/settings/SettingsLayout";
import General from "./pages/settings/General";
import Appearance from "./pages/settings/Appearance";
import Hardware from "./pages/settings/Hardware";
import Network from "./pages/settings/Network";
import Plugins from "./pages/settings/Plugins";
import Notifications from "./pages/settings/Notifications";
import Developer from "./pages/settings/Developer";
import About from "./pages/settings/About";

function AppRoutes() {
  // Keyed by pathname: a plain class-based ErrorBoundary doesn't reset
  // itself when children change, so without this key, a crash on one
  // page would stay stuck on the error screen even after navigating
  // elsewhere - defeating the point of "use the menu to go elsewhere".
  const location = useLocation();

  return (
    <ErrorBoundary key={location.pathname}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/energy" element={<Energy />} />
        <Route path="/battery" element={<Battery />} />
        <Route path="/solar" element={<Solar />} />
        <Route path="/weather" element={<Weather />} />
        <Route path="/nearby" element={<Nearby />} />
        <Route path="/switches" element={<Relays />} />
        <Route path="/camera" element={<Camera />} />
        <Route path="/history" element={<History />} />

        <Route path="/settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="general" replace />} />
          <Route path="general" element={<General />} />
          <Route path="appearance" element={<Appearance />} />
          <Route path="hardware" element={<Hardware />} />
          <Route path="network" element={<Network />} />
          <Route path="plugins" element={<Plugins />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="developer" element={<Developer />} />
          <Route path="about" element={<About />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}

function Gate() {
  const { ready, unlocked } = useAuth();

  // Avoid a flash of the unlock screen while we're still checking
  // whether a password is even configured - most existing deployments
  // have none set, and briefly showing a lock screen they'll never
  // need would be a confusing regression for them.
  if (!ready) return null;

  if (!unlocked) return <UnlockScreen />;

  return (
    <LocationProvider>
      <TelemetryProvider>
        {/* Opting into v7 behaviour early, which also silences React
            Router's future-flag console warnings.

            v7_relativeSplatPath was verified as inert here rather than
            assumed: it only changes how RELATIVE paths resolve inside
            SPLAT (`*`) parent routes. This app has no splat routes at
            all, and the only <Link> under /settings (Plugins ->
            Configure) uses absolute paths like "/settings/hardware".
            Nothing to resolve relatively, so nothing to break. */}
        <BrowserRouter
          future={{
            v7_startTransition: true,
            v7_relativeSplatPath: true,
          }}
        >
          <UpdateBanner />
          <MissionBriefModal />
          <AppLayout>
            <AppRoutes />
          </AppLayout>
        </BrowserRouter>
      </TelemetryProvider>
    </LocationProvider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </ThemeProvider>
  );
}
