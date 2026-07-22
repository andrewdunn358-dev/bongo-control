import { NavLink } from 'react-router-dom';
import {
  Home,
  ToggleRight,
  CloudSun,
  MapPin,
  Camera,
  Settings as SettingsIcon,
  Zap,
  Battery,
  Sun,
  LineChart,
} from 'lucide-react';
import { StatusPill } from '@/components/primitives/StatusPill';
import { NAV } from '@/constants/testIds';
import { cn } from '@/lib/utils';
import { isDemo } from '@/lib/demo';

// The static demo is branded VanOS (the platform); the real van build is
// Bongo Control (the first vehicle).
const BRAND = { letter: isDemo ? 'V' : 'B', sub: isDemo ? 'campervan dashboard' : 'van cockpit' };
function BrandName() {
  return isDemo ? (
    <>Van<span className="text-aurora-teal">OS</span></>
  ) : (
    <>BONGO<span className="text-aurora-teal">·</span>CONTROL</>
  );
}

interface NavLinkDef {
  to: string;
  label: string;
  short: string;
  icon: typeof Home;
  testId: string;
  mobile: boolean;
  end?: boolean;
}

// 10 screens total; mobile bottom nav shows 6 (marked `mobile: true`).
const LINKS: NavLinkDef[] = [
  { to: '/', label: 'Home', short: 'Home', icon: Home, testId: NAV.home, mobile: true, end: true },
  { to: '/energy', label: 'Energy', short: 'Energy', icon: Zap, testId: NAV.energy, mobile: false },
  { to: '/battery', label: 'Battery', short: 'Bat', icon: Battery, testId: NAV.battery, mobile: false },
  { to: '/solar', label: 'Solar', short: 'Sun', icon: Sun, testId: NAV.solar, mobile: false },
  { to: '/weather', label: 'Weather', short: 'Sky', icon: CloudSun, testId: NAV.weather, mobile: true },
  { to: '/nearby', label: 'Nearby', short: 'Map', icon: MapPin, testId: NAV.nearby, mobile: true },
  { to: '/switches', label: 'Switches', short: 'Switch', icon: ToggleRight, testId: NAV.switches, mobile: true },
  { to: '/camera', label: 'Camera', short: 'Cam', icon: Camera, testId: NAV.camera, mobile: true },
  { to: '/history', label: 'History', short: 'Graph', icon: LineChart, testId: NAV.history, mobile: false },
  { to: '/settings', label: 'Settings', short: 'Set', icon: SettingsIcon, testId: NAV.settings, mobile: true },
];

const MOBILE = LINKS.filter((l) => l.mobile);

export function NavShell({ children, wsConnected }: { children: React.ReactNode; wsConnected: boolean }) {
  return (
    <div className="min-h-screen">
      {/* Top nav — tablet / desktop */}
      <header
        data-testid={NAV.root}
        className="hidden md:flex sticky top-0 z-40 items-center justify-between gap-6 px-6 lg:px-10 py-5 backdrop-blur-md bg-surface/60 border-b border-ink/5"
      >
        <div data-testid={NAV.brand} className="flex items-center gap-3">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-aurora-teal to-aurora-purple grid place-items-center">
            <span className="text-navy-900 font-bold text-2xl">{BRAND.letter}</span>
          </div>
          <div className="leading-tight">
            <div className="font-semibold tracking-tight text-2xl"><BrandName /></div>
            <div className="text-xs uppercase tracking-[0.2em] text-ink-muted">{BRAND.sub}</div>
          </div>
        </div>

        <nav className="flex items-center gap-2 flex-wrap">
          {LINKS.map(({ to, label, icon: Icon, testId, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              data-testid={testId}
              className={({ isActive }) =>
                cn(
                  'group relative flex items-center gap-2.5 rounded-full px-5 py-3 text-lg font-medium transition-colors',
                  isActive
                    ? 'text-ink bg-ink/[0.06] ring-1 ring-inset ring-aurora-teal/40 shadow-[inset_0_0_18px_rgba(34,211,238,0.15)]'
                    : 'text-ink-muted hover:text-ink hover:bg-ink/[0.03]',
                )
              }
            >
              <Icon size={22} className="opacity-90" />
              <span className="hidden lg:inline">{label}</span>
            </NavLink>
          ))}
        </nav>

        <StatusPill tone={wsConnected ? 'teal' : 'red'} data-testid={NAV.wsIndicator}>
          {wsConnected ? 'LIVE' : 'OFFLINE'}
        </StatusPill>
      </header>

      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-40 flex items-center justify-between px-4 py-3 backdrop-blur-md bg-surface/70 border-b border-ink/5">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-aurora-teal to-aurora-purple grid place-items-center">
            <span className="text-navy-900 font-bold">{BRAND.letter}</span>
          </div>
          <div className="font-semibold tracking-tight text-sm"><BrandName /></div>
        </div>
        <StatusPill tone={wsConnected ? 'teal' : 'red'}>{wsConnected ? 'LIVE' : 'OFFLINE'}</StatusPill>
      </header>

      <main className="pb-24 md:pb-8">{children}</main>

      {/* Mobile bottom tab bar — 6 items */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-ink/5 bg-surface/90 backdrop-blur-md">
        <ul className="grid" style={{ gridTemplateColumns: `repeat(${MOBILE.length}, minmax(0,1fr))` }}>
          {MOBILE.map(({ to, short, icon: Icon, testId, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                data-testid={`${testId}-mobile`}
                className={({ isActive }) =>
                  cn(
                    'flex flex-col items-center justify-center gap-0.5 py-2 text-[10px]',
                    isActive ? 'text-aurora-teal' : 'text-ink-muted',
                  )
                }
              >
                <Icon size={18} />
                <span className="leading-none">{short}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
