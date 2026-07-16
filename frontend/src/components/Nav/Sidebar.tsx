import { NavLink } from "react-router-dom";
import { navItems } from "./navConfig";
import { useTelemetry } from "../../context/TelemetryContext";

export default function Sidebar() {
  const { connected } = useTelemetry();

  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-border-hairline bg-surface-raised md:flex">
      <div className="flex items-center gap-2 px-5 py-6">
        <span className="h-2 w-2 rounded-full bg-solar" />
        <span className="font-display text-sm font-semibold tracking-wide">Bongo Control</span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                  isActive ? "bg-surface-cardHover text-text-primary" : "text-text-secondary hover:text-text-primary"
                }`
              }
            >
              <Icon size={18} />
              {item.label}
            </NavLink>
          );
        })}
      </nav>

      <div className="flex items-center gap-2 px-5 py-4 text-xs text-text-muted">
        <span className={`h-2 w-2 rounded-full ${connected ? "bg-battery" : "bg-alert"}`} />
        {connected ? "Live" : "Reconnecting..."}
      </div>
    </aside>
  );
}
