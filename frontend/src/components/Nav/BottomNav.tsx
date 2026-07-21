import { NavLink } from "react-router-dom";
import { primaryNavItems } from "./navConfig";

export default function BottomNav() {
  return (
    <nav
      className="fixed inset-x-3 bottom-3 z-30 flex gap-1 rounded-[1.6rem] border border-ink/[0.08] bg-surface-card/75 p-1.5 shadow-[0_18px_50px_-8px_rgb(var(--color-base-deep)/0.75),inset_0_1px_0_rgb(var(--color-ink)/0.10)] backdrop-blur-2xl lg:hidden"
      style={{ paddingBottom: "calc(0.375rem + env(safe-area-inset-bottom))" }}
    >
      {primaryNavItems.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === "/"}
            className={({ isActive }) =>
              `flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-2xl text-[0.65rem] font-bold uppercase tracking-[0.12em] transition-all ${
                isActive ? "bg-battery/14 text-battery shadow-[inset_0_0_0_1px_rgba(0,194,168,0.14)]" : "text-ink/38"
              }`
            }
          >
            <Icon size={21} />
            {item.label}
          </NavLink>
        );
      })}
    </nav>
  );
}
