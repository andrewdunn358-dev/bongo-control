import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { TelemetryProvider } from "./context/TelemetryContext";
import AppLayout from "./components/Layout/AppLayout";
import Home from "./pages/Home";
import Energy from "./pages/Energy";
import Battery from "./pages/Battery";
import Solar from "./pages/Solar";
import History from "./pages/History";
import Environment from "./pages/Environment";
import Connectivity from "./pages/Connectivity";
import SettingsLayout from "./pages/settings/SettingsLayout";
import General from "./pages/settings/General";
import Appearance from "./pages/settings/Appearance";
import Hardware from "./pages/settings/Hardware";
import Plugins from "./pages/settings/Plugins";
import Notifications from "./pages/settings/Notifications";
import Developer from "./pages/settings/Developer";
import About from "./pages/settings/About";

export default function App() {
  return (
    <TelemetryProvider>
      <BrowserRouter>
        <AppLayout>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/energy" element={<Energy />} />
            <Route path="/battery" element={<Battery />} />
            <Route path="/solar" element={<Solar />} />
            <Route path="/history" element={<History />} />
            <Route path="/environment" element={<Environment />} />
            <Route path="/connectivity" element={<Connectivity />} />

            <Route path="/settings" element={<SettingsLayout />}>
              <Route index element={<Navigate to="general" replace />} />
              <Route path="general" element={<General />} />
              <Route path="appearance" element={<Appearance />} />
              <Route path="hardware" element={<Hardware />} />
              <Route path="plugins" element={<Plugins />} />
              <Route path="notifications" element={<Notifications />} />
              <Route path="developer" element={<Developer />} />
              <Route path="about" element={<About />} />
            </Route>
          </Routes>
        </AppLayout>
      </BrowserRouter>
    </TelemetryProvider>
  );
}
