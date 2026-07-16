// Single source of truth for the app's page list. Add a route here and
// it appears in nav + routing automatically — no need to edit both.

export interface NavItem {
  path: string;
  label: string;
}

export const navItems: NavItem[] = [
  { path: "/", label: "Home" },
  { path: "/energy", label: "Energy" },
  { path: "/battery", label: "Battery" },
  { path: "/solar", label: "Solar" },
  { path: "/history", label: "History" },
  { path: "/environment", label: "Environment" },
  { path: "/connectivity", label: "Connectivity" },
  { path: "/vehicle", label: "Vehicle" },
  { path: "/settings", label: "Settings" },
];
