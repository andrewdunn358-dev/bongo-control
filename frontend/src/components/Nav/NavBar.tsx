import { NavLink } from "react-router-dom";
import { navItems } from "./navConfig";
import { useTelemetry } from "../../context/TelemetryContext";

// Intentionally unstyled/minimal — this gets replaced once the design
// system (docs/design-system.md) is finalized. Its job right now is
// pure navigation, not visual polish.
export default function NavBar() {
  const { connected } = useTelemetry();

  return (
    <nav className="flex items-center justify-between border-b border-white/10 bg-surface-raised px-4 py-3">
      <div className="flex items-center gap-4 overflow-x-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === "/"}
            className={({ isActive }) =>
              `whitespace-nowrap rounded px-3 py-1.5 text-sm transition-colors ${
                isActive ? "bg-accent text-black" : "text-white/70 hover:text-white"
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </div>
      <span
        title={connected ? "Connected to telemetry stream" : "Disconnected — reconnecting..."}
        className={`ml-4 h-2.5 w-2.5 shrink-0 rounded-full ${connected ? "bg-accent" : "bg-red-500"}`}
      />
    </nav>
  );
}
