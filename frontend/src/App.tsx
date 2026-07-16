import { BrowserRouter, Routes, Route } from "react-router-dom";
import { TelemetryProvider } from "./context/TelemetryContext";
import AppLayout from "./components/Layout/AppLayout";
import Home from "./pages/Home";
import Energy from "./pages/Energy";
import Battery from "./pages/Battery";
import Solar from "./pages/Solar";
import History from "./pages/History";
import Environment from "./pages/Environment";
import Connectivity from "./pages/Connectivity";
import Vehicle from "./pages/Vehicle";
import Settings from "./pages/Settings";

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
            <Route path="/vehicle" element={<Vehicle />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </AppLayout>
      </BrowserRouter>
    </TelemetryProvider>
  );
}
