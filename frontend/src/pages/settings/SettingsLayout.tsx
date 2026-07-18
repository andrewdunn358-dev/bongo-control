import { NavLink, Outlet } from "react-router-dom";
import { SlidersHorizontal, Palette, Cpu, Puzzle, Bell, Code2, Info, Wifi } from "lucide-react";

const sections = [
  { path: "general", label: "General", icon: SlidersHorizontal },
  { path: "appearance", label: "Appearance", icon: Palette },
  { path: "hardware", label: "Hardware", icon: Cpu },
  { path: "network", label: "Network", icon: Wifi },
  { path: "plugins", label: "Plugins", icon: Puzzle },
  { path: "notifications", label: "Notifications", icon: Bell },
  { path: "developer", label: "Developer", icon: Code2 },
  { path: "about", label: "About", icon: Info },
];

/**
 * Settings framework (Sprint 4): sub-navigation + routed sections.
 * Only Plugins has real functionality this sprint — the rest are
 * framework/navigation per spec, and say so honestly rather than
 * simulating content that doesn't exist yet.
 */
export default function SettingsLayout() {
  return (
    <div className="space-y-4">
      <nav className="flex gap-1 overflow-x-auto border-b border-white/10 pb-px">
        {sections.map((s) => {
          const Icon = s.icon;
          return (
            <NavLink
              key={s.path}
              to={s.path}
              className={({ isActive }) =>
                `flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors ${
                  isActive ? "border-solar text-text-primary" : "border-transparent text-text-secondary hover:text-text-primary"
                }`
              }
            >
              <Icon size={14} />
              {s.label}
            </NavLink>
          );
        })}
      </nav>
      <Outlet />
    </div>
  );
}
