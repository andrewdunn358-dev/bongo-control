import { NavLink } from 'react-router-dom';
import {
  Gauge,
  ShieldCheck,
  MapPin,
  CloudSun,
  Camera,
  LineChart,
  Wifi,
} from 'lucide-react';
import { NAV } from '@/constants/testIds';
import { StatusPill } from '@/components/primitives/StatusPill';
import { cn } from '@/lib/utils';

const LINKS = [
  { to: '/', label: 'Dashboard', short: 'Home', icon: Gauge, testId: NAV.linkDashboard, end: true },
  { to: '/sitrep', label: 'SITREP', short: 'SITREP', icon: ShieldCheck, testId: NAV.linkSitrep },
  { to: '/nearby', label: 'Nearby', short: 'Map', icon: MapPin, testId: NAV.linkNearby },
  { to: '/weather', label: 'Weather', short: 'Sky', icon: CloudSun, testId: NAV.linkWeather },
  { to: '/camera', label: 'Camera', short: 'Cam', icon: Camera, testId: NAV.linkCamera },
  { to: '/history', label: 'History', short: 'Graph', icon: LineChart, testId: NAV.linkHistory },
  { to: '/settings', label: 'WiFi & Settings', short: 'WiFi', icon: Wifi, testId: NAV.linkSettings },
];

export const NavShell = ({ children, wsConnected }) => (
  <div className="min-h-screen">
    {/* Top nav — tablet / desktop */}
    <header
      data-testid={NAV.root}
      className="hidden md:flex sticky top-0 z-40 items-center justify-between gap-6 px-6 lg:px-10 py-4 backdrop-blur-md bg-navy-900/60 border-b border-white/5"
    >
      <div data-testid={NAV.brand} className="flex items-center gap-3">
        <div className="relative h-9 w-9 rounded-xl bg-gradient-to-br from-aurora-teal to-aurora-purple shadow-glow-teal grid place-items-center">
          <span className="text-navy-900 font-bold text-lg">B</span>
        </div>
        <div className="leading-tight">
          <div className="text-white font-semibold tracking-tight">BONGO<span className="text-aurora-teal">·</span>CONTROL</div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400">van cockpit</div>
        </div>
      </div>

      <nav className="flex items-center gap-1">
        {LINKS.map(({ to, label, icon: Icon, testId, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            data-testid={testId}
            className={({ isActive }) =>
              cn(
                'group relative flex items-center gap-2 rounded-full px-3.5 py-2 text-sm transition-colors',
                isActive
                  ? 'text-white bg-white/[0.06] ring-1 ring-inset ring-aurora-teal/40 shadow-[inset_0_0_18px_rgba(34,211,238,0.15)]'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.03]'
              )
            }
          >
            <Icon size={16} className="opacity-90" />
            <span className="hidden lg:inline">{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="flex items-center gap-3">
        <StatusPill
          tone={wsConnected ? 'teal' : 'red'}
          data-testid={NAV.wsIndicator}
        >
          {wsConnected ? 'LIVE' : 'OFFLINE'}
        </StatusPill>
      </div>
    </header>

    {/* Mobile top bar with brand only */}
    <header className="md:hidden sticky top-0 z-40 flex items-center justify-between px-4 py-3 backdrop-blur-md bg-navy-900/70 border-b border-white/5">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-aurora-teal to-aurora-purple grid place-items-center">
          <span className="text-navy-900 font-bold">B</span>
        </div>
        <div className="text-white font-semibold tracking-tight text-sm">BONGO<span className="text-aurora-teal">·</span>CONTROL</div>
      </div>
      <StatusPill tone={wsConnected ? 'teal' : 'red'}>
        {wsConnected ? 'LIVE' : 'OFFLINE'}
      </StatusPill>
    </header>

    <main className="pb-24 md:pb-8">{children}</main>

    {/* Bottom tab bar — phone */}
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-white/5 bg-navy-900/85 backdrop-blur-md">
      <ul className="grid grid-cols-7">
        {LINKS.map(({ to, short, icon: Icon, testId, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              data-testid={`${testId}-mobile`}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center justify-center gap-0.5 py-2 text-[10px]',
                  isActive ? 'text-aurora-teal' : 'text-slate-400'
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
