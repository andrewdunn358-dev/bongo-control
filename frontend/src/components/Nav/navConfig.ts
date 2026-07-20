import { Home, Zap, BatteryMedium, Sun, History, Settings, MapPin, CloudSun, Video, ToggleLeft } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
}

// Single source of truth for the app's page list. Add a route here and
// it appears in both the desktop sidebar and mobile bottom nav.
export const navItems: NavItem[] = [
  { path: "/", label: "Home", icon: Home },
  { path: "/energy", label: "Energy", icon: Zap },
  { path: "/battery", label: "Battery", icon: BatteryMedium },
  { path: "/solar", label: "Solar", icon: Sun },
  { path: "/weather", label: "Weather", icon: CloudSun },
  { path: "/nearby", label: "Nearby", icon: MapPin },
  { path: "/switches", label: "Switches", icon: ToggleLeft },
  { path: "/camera", label: "Camera", icon: Video },
  { path: "/history", label: "History", icon: History },
  { path: "/settings", label: "Settings", icon: Settings },
];

// A shorter set for the mobile bottom tab bar — 9 tabs would be
// cramped and defeats "large touch targets". The rest remain reachable
// via the sidebar on larger screens; mobile users get the primary six,
// consistent with how Tesla/EcoFlow mobile apps prioritize their tab bars.
// Camera included deliberately - "check on the van remotely" is one of
// the more obviously mobile-first use cases in the whole app.
export const primaryNavItems: NavItem[] = navItems.filter((item) =>
  ["/", "/battery", "/weather", "/nearby", "/camera", "/settings"].includes(item.path)
);
