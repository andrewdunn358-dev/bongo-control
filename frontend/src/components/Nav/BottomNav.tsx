import { NavLink } from "react-router-dom";
import { primaryNavItems } from "./navConfig";

export default function BottomNav() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border-hairline bg-surface-raised/95 backdrop-blur md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {primaryNavItems.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === "/"}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-1 py-3 text-[11px] transition-colors ${
                isActive ? "text-solar" : "text-text-muted"
              }`
            }
          >
            {/* min 44px touch target per side padding, per accessibility guidance */}
            <Icon size={22} />
            {item.label}
          </NavLink>
        );
      })}
    </nav>
  );
}
