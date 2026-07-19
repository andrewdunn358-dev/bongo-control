import { NavLink, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { Gauge } from "lucide-react";
import { navItems } from "./navConfig";
import { useTelemetry } from "../../context/TelemetryContext";
import LiveIndicator from "../Cards/LiveIndicator";

export default function Sidebar() {
  const { connected, state } = useTelemetry();
  const location = useLocation();

  const lastUpdated =
    Math.max(
      0,
      ...Object.values(state)
        .map((m) => m?.timestamp)
        .filter((t): t is number => typeof t === "number")
    ) || null;

  return (
    <aside className="relative z-20 hidden w-[5.75rem] shrink-0 flex-col border-r border-white/[0.07] bg-base/82 px-3 py-4 backdrop-blur-xl lg:flex xl:w-72 xl:px-5">
      <div className="mb-7 flex items-center justify-center gap-3 xl:justify-start">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-battery/25 bg-battery/12 shadow-[0_0_26px_rgba(0,194,168,0.18)]">
          <Gauge size={22} className="text-battery" />
        </div>
        <div className="hidden xl:block">
          <div className="text-sm font-bold uppercase tracking-[0.2em] text-white">Bongo</div>
          <div className="text-[0.65rem] font-semibold uppercase tracking-[0.24em] text-white/38">Control OS</div>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.path === "/" ? location.pathname === "/" : location.pathname.startsWith(item.path);
          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/"}
              aria-label={item.label}
              className="group relative flex h-14 items-center justify-center rounded-2xl text-white/42 transition-colors duration-200 hover:text-white xl:justify-start xl:gap-3 xl:px-4"
            >
              {isActive && (
                <motion.span
                  layoutId="sidebar-active-pill"
                  className="absolute inset-0 rounded-2xl border border-battery/20 bg-battery/12 shadow-[0_0_30px_rgba(0,194,168,0.13)]"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              <Icon size={21} className={`relative z-10 ${isActive ? "text-battery" : ""}`} />
              <span className={`relative z-10 hidden text-sm font-semibold xl:inline ${isActive ? "text-white" : ""}`}>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="flex justify-center border-t border-white/[0.07] pt-4 xl:justify-start">
        <LiveIndicator lastUpdated={lastUpdated} connected={connected} />
      </div>
    </aside>
  );
}
