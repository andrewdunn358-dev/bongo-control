import { NavLink, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { navItems } from "./navConfig";
import { useTelemetry } from "../../context/TelemetryContext";
import LiveIndicator from "../Cards/LiveIndicator";

export default function Sidebar() {
  const { connected, state } = useTelemetry();
  const location = useLocation();

  // Most recent timestamp across whatever domains currently have data -
  // a reasonable proxy for "when did we last hear from the hardware at all".
  const lastUpdated = Math.max(
    0,
    ...Object.values(state)
      .map((m) => m?.timestamp)
      .filter((t): t is number => typeof t === "number")
  ) || null;

  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-border-hairline bg-surface-raised md:flex">
      <div className="flex items-center gap-2 px-5 py-6">
        <span className="h-2 w-2 rounded-full bg-solar" />
        <span className="font-display text-sm font-semibold tracking-wide">Bongo Control</span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.path === "/" ? location.pathname === "/" : location.pathname.startsWith(item.path);
          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/"}
              className="relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-text-secondary transition-colors duration-200 hover:bg-white/5 hover:text-text-primary"
            >
              {isActive && (
                <motion.span
                  layoutId="sidebar-active-pill"
                  className="absolute inset-0 rounded-lg bg-surface-cardHover"
                  transition={{ type: "spring", stiffness: 400, damping: 35 }}
                />
              )}
              <Icon size={18} className={`relative z-10 ${isActive ? "text-solar" : ""}`} />
              <span className={`relative z-10 ${isActive ? "text-text-primary" : ""}`}>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="px-5 py-4">
        <LiveIndicator lastUpdated={lastUpdated} connected={connected} />
      </div>
    </aside>
  );
}
