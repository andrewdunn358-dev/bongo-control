import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import brandMark from '../assets/brand-mark.png';
import {
  Home,
  ToggleRight,
  ChevronsUp,
  CloudSun,
  MapPin,
  Camera,
  Settings as SettingsIcon,
  Zap,
  LineChart,
  Route,
  Satellite,
  SignalHigh,
  Thermometer,
  BatteryCharging,
  Sparkles,
  Radio as RadioIcon,
  Flame,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { StatusPill } from '@/components/primitives/StatusPill';
import { getTelemetryCloseReason } from '@/lib/telemetry';
import { NAV } from '@/constants/testIds';
import { cn } from '@/lib/utils';
import { isDemo } from '@/lib/demo';
import { useNavigationStyle } from '@/lib/useNavigationStyle';
import { useCockpitTheme } from '@/lib/useCockpitTheme';
import { api } from '@/lib/api';
import { useBattery, useEnvironment } from '@/lib/telemetry';
import { fmtVolt, fmtTemp, DASH } from '@/lib/format';
import { useLayoutMode } from '@/lib/useLayoutMode';

const BRAND = { sub: isDemo ? 'campervan dashboard' : 'van cockpit' };
function BrandName() {
  return <>Van<span className="text-aurora-teal">OS</span></>;
}

interface NavLinkDef {
  to: string;
  label: string;
  short: string;
  icon: typeof Home;
  testId: string;
  end?: boolean;
}

const LINKS: NavLinkDef[] = [
  { to: '/', label: 'Home', short: 'Home', icon: Home, testId: NAV.home, end: true },
  { to: '/power', label: 'Power', short: 'Power', icon: Zap, testId: NAV.power },
  { to: '/weather', label: 'Weather', short: 'Weather', icon: CloudSun, testId: NAV.weather },
  { to: '/nearby', label: 'Nearby', short: 'Nearby', icon: MapPin, testId: NAV.nearby },
  { to: '/coverage', label: 'Coverage', short: 'Coverage', icon: SignalHigh, testId: NAV.coverage },
  { to: '/radio', label: 'Radio', short: 'Radio', icon: RadioIcon, testId: NAV.radio },
  { to: '/switches', label: 'Switches', short: 'Switch', icon: ToggleRight, testId: NAV.switches },
  { to: '/roof', label: 'Roof', short: 'Roof', icon: ChevronsUp, testId: NAV.roof },
  { to: '/heater', label: 'Heater', short: 'Heat', icon: Flame, testId: NAV.heater },
  { to: '/camera', label: 'Camera', short: 'Cam', icon: Camera, testId: NAV.camera },
  { to: '/history', label: 'History', short: 'History', icon: LineChart, testId: NAV.history },
  { to: '/trips', label: 'Trips', short: 'Trips', icon: Route, testId: NAV.trips },
  { to: '/chat', label: 'Chat', short: 'Chat', icon: Sparkles, testId: NAV.chat },
  { to: '/settings', label: 'Settings', short: 'Set', icon: SettingsIcon, testId: NAV.settings },
];

function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function BottomNavigation() {
  return (
    <nav className="fixed bottom-4 inset-x-4 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 z-40 md:w-auto">
      <ul className="flex overflow-x-auto scrollbar-hide gap-1 rounded-2xl bg-surface-raised ring-1 ring-line/40 px-2 py-2 shadow-xl md:justify-center">
        {LINKS.map(({ to, short, icon: Icon, testId, end }) => (
          <li key={to} className="shrink-0">
            <NavLink
              to={to}
              end={end}
              data-testid={`${testId}-mobile`}
              className={({ isActive }) => cn(
                'flex flex-col items-center justify-center gap-0.5 py-1.5 px-3 rounded-xl text-[10px] transition-colors',
                isActive ? 'text-brand-orange bg-brand-orange/15' : 'text-ink-muted hover:text-ink-soft',
              )}
            >
              <Icon size={17} />
              <span className="leading-none">{short}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function SidebarNavigation({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <nav
      className={cn(
        'fixed left-0 top-0 bottom-0 z-40 flex flex-col border-r border-line/40 bg-surface-raised',
        'transition-[width] duration-200 ease-out',
        expanded ? 'w-[220px]' : 'w-[78px]',
      )}
      data-testid={NAV.sidebar}
    >
      <div className={cn('flex items-center gap-2.5 px-4 py-3.5 shrink-0', !expanded && 'justify-center px-0')}>
        <img src={brandMark} alt="" className="h-8 w-8 rounded-lg shrink-0" />
        {expanded && (
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-tight truncate">VanOS</div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-ink-muted truncate">Van cockpit</div>
          </div>
        )}
      </div>

      <ul className="flex-1 overflow-y-auto scrollbar-hide px-2 py-1 space-y-0.5">
        {LINKS.map(({ to, label, icon: Icon, testId, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              title={!expanded ? label : undefined}
              data-testid={`${testId}-sidebar`}
              className={({ isActive }) => cn(
                'flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] transition-colors',
                !expanded && 'justify-center px-0',
                isActive ? 'text-brand-orange bg-brand-orange/15' : 'text-ink-muted hover:text-ink-soft',
              )}
            >
              <Icon size={18} className="shrink-0" />
              {expanded && <span className="truncate">{label}</span>}
            </NavLink>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onToggle}
        aria-label={expanded ? 'Collapse navigation' : 'Expand navigation'}
        className={cn(
          'flex items-center gap-3 px-3 py-3 m-2 rounded-xl text-[12px] text-ink-muted hover:text-ink-soft transition-colors shrink-0',
          !expanded && 'justify-center px-0',
        )}
      >
        {expanded ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        {expanded && <span>Collapse</span>}
      </button>
    </nav>
  );
}

export function NavShell({ children, wsConnected }: { children: React.ReactNode; wsConnected: boolean }) {
  const battery = useBattery();
  const env = useEnvironment();
  const now = useClock();
  const loc = useQuery({ queryKey: ['location'], queryFn: api.location, retry: false });
  const { effectiveStyle } = useNavigationStyle();

  // The layout mode is published HERE, not in Home. The shell wraps every
  // page; Home does not. Setting it from Home meant that opening /roof or
  // /switches directly - or rotating while on them - left <html> with no
  // data-layout at all, so every landscape rule in the app silently did
  // nothing. Found by measuring the Roof page and seeing mode=None.
  useLayoutMode();

  // Collapse the rail when the device is ROTATED into landscape, not
  // only when the app starts there. The initial state runs once on
  // mount, so rotating portrait -> landscape kept a 220px rail on a
  // 730px viewport and the cockpit came up 21px over. Measured.
  useEffect(() => {
    const short = window.matchMedia('(max-height: 500px)');
    const onChange = () => {
      if (short.matches && window.innerWidth < 900) setSidebarExpanded(false);
    };
    short.addEventListener('change', onChange);
    return () => short.removeEventListener('change', onChange);
  }, []);
  useCockpitTheme();

  // In landscape the rail starts collapsed: 220px of a 730px viewport is
  // a third of the width, which squeezes the four cards narrow enough to
  // wrap and grow taller - the opposite of what a short viewport needs.
  // 78px leaves 604px, and the user can still expand it.
  const [sidebarExpanded, setSidebarExpanded] = useState(() => {
    try {
      if (window.matchMedia('(max-height: 500px)').matches && window.innerWidth < 900) return false;
      return window.localStorage.getItem('vanos-sidebar-expanded') !== 'false';
    } catch {
      return true;
    }
  });
  const toggleSidebar = () => {
    setSidebarExpanded((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('vanos-sidebar-expanded', String(next));
      } catch {
        /* preference just won't persist */
      }
      return next;
    });
  };
  const sidebarOn = effectiveStyle === 'sidebar';

  const dateStr = now.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div
      className={cn(
        'van-shell min-h-screen transition-[padding-left] duration-200 ease-out',
        sidebarOn && (sidebarExpanded ? 'pl-[220px]' : 'pl-[78px]'),
      )}
    >
      {sidebarOn && <SidebarNavigation expanded={sidebarExpanded} onToggle={toggleSidebar} />}

      <header
        data-testid={NAV.root}
        className="vs-header sticky top-0 z-40 flex items-center justify-between gap-3 px-4 md:px-6 py-3 bg-surface-raised border-b border-line/40"
      >
        <div data-testid={NAV.brand} className="flex items-center gap-2.5 shrink-0">
          <img
            src={brandMark}
            alt=""
            width={36}
            height={36}
            className="h-9 w-9 rounded-xl object-cover shadow-[0_0_14px_rgba(178,97,0,0.4)]"
          />
          <div className="vs-brand-text leading-tight hidden sm:block">
            <div className="font-semibold tracking-tight text-sm"><BrandName /></div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-ink-muted">{BRAND.sub}</div>
          </div>
        </div>

        <div className="vs-clock text-center">
          <span className="num text-lg font-semibold">{timeStr}</span>
          <span className="vs-date text-[10px] text-ink-muted ml-2 tracking-wider">{dateStr}</span>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {loc.data?.satellites != null && (
            <span className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs bg-surface-sunken ring-1 ring-line/30 text-ink-soft">
              <Satellite size={12} className="text-aurora-teal" /> GPS {loc.data.satellites}
            </span>
          )}
          {env.payload?.external_temp_c != null && (
            <span className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs bg-surface-sunken ring-1 ring-line/30 text-ink-soft">
              <Thermometer size={12} /> {fmtTemp(env.payload.external_temp_c)}
            </span>
          )}
          <span className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs bg-surface-sunken ring-1 ring-line/30 text-ink-soft">
            <BatteryCharging size={12} className={battery.payload?.charging ? 'text-status-green' : ''} />
            {battery.payload?.voltage != null ? fmtVolt(battery.payload.voltage) : DASH}
          </span>
          {isDemo ? (
            <a href="https://github.com/andrewdunn358-dev/bongo-control" target="_blank" rel="noreferrer">
              <StatusPill tone="purple" data-testid={NAV.wsIndicator}>DEMO · view source</StatusPill>
            </a>
          ) : (
            <StatusPill
              tone={wsConnected ? 'teal' : 'red'}
              data-testid={NAV.wsIndicator}
              title={wsConnected ? 'Live telemetry connected' : getTelemetryCloseReason() ?? 'Connecting…'}
            >{wsConnected ? 'LIVE' : 'OFFLINE'}</StatusPill>
          )}
        </div>
      </header>

      <main className={cn('van-mainel min-w-0 pt-6 px-4 md:px-6', sidebarOn ? 'pb-8' : 'pb-28')}>{children}</main>

      {effectiveStyle === 'dock' && <BottomNavigation />}
    </div>
  );
}
