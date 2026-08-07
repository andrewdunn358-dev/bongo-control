import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Home,
  ToggleRight,
  ChevronsUp,
  CloudSun,
  MapPin,
  Camera,
  Settings as SettingsIcon,
  Zap,
  Battery,
  Sun,
  LineChart,
  Route,
  Satellite,
  SignalHigh,
  Thermometer,
  BatteryCharging,
} from 'lucide-react';
import { StatusPill } from '@/components/primitives/StatusPill';
import { NAV } from '@/constants/testIds';
import { cn } from '@/lib/utils';
import { isDemo } from '@/lib/demo';
import { api } from '@/lib/api';
import { useBattery, useEnvironment } from '@/lib/telemetry';
import { fmtVolt, fmtTemp, DASH } from '@/lib/format';

const BRAND = { letter: 'V', sub: isDemo ? 'campervan dashboard' : 'van cockpit' };
function BrandName() {
  return (
    <>Van<span className="text-aurora-teal">OS</span></>
  );
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
  { to: '/energy', label: 'Energy', short: 'Energy', icon: Zap, testId: NAV.energy },
  { to: '/battery', label: 'Battery', short: 'Bat', icon: Battery, testId: NAV.battery },
  { to: '/solar', label: 'Solar', short: 'Sun', icon: Sun, testId: NAV.solar },
  { to: '/weather', label: 'Weather', short: 'Sky', icon: CloudSun, testId: NAV.weather },
  { to: '/nearby', label: 'Nearby', short: 'Map', icon: MapPin, testId: NAV.nearby },
  { to: '/coverage', label: 'Coverage', short: 'Signal', icon: SignalHigh, testId: NAV.coverage },
  { to: '/switches', label: 'Switches', short: 'Switch', icon: ToggleRight, testId: NAV.switches },
  { to: '/roof', label: 'Roof', short: 'Roof', icon: ChevronsUp, testId: NAV.roof },
  { to: '/camera', label: 'Camera', short: 'Cam', icon: Camera, testId: NAV.camera },
  { to: '/history', label: 'History', short: 'Graph', icon: LineChart, testId: NAV.history },
  { to: '/trips', label: 'Trips', short: 'Trips', icon: Route, testId: NAV.trips },
  { to: '/settings', label: 'Settings', short: 'Set', icon: SettingsIcon, testId: NAV.settings },
];

/** Live clock, ticking every second - the reference's top bar shows a
 *  real running clock, not a static render-time timestamp. */
function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function NavShell({ children, wsConnected }: { children: React.ReactNode; wsConnected: boolean }) {
  const battery = useBattery();
  const env = useEnvironment();
  const now = useClock();
  const loc = useQuery({ queryKey: ['location'], queryFn: api.location, retry: false });

  const dateStr = now.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="min-h-screen">
      {/* Top status bar - real data throughout. No fabricated cellular/
          WiFi-speed pills here (this van has no modem - WiFi + Cloudflare
          Tunnel only), unlike the reference this was matched against -
          only showing numbers this van's actual hardware can back up. */}
      <header
        data-testid={NAV.root}
        className="sticky top-0 z-40 flex items-center justify-between gap-3 px-4 md:px-6 py-3 bg-black/40 backdrop-blur-md border-b border-white/8 flex-wrap"
      >
        <div data-testid={NAV.brand} className="flex items-center gap-2.5 shrink-0">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-brand-orange to-amber-400 grid place-items-center shadow-[0_0_14px_rgba(178,97,0,0.4)]">
            <span className="text-navy-900 font-bold">{BRAND.letter}</span>
          </div>
          <div className="leading-tight hidden sm:block">
            <div className="font-semibold tracking-tight text-sm"><BrandName /></div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-ink-muted">{BRAND.sub}</div>
          </div>
        </div>

        <div className="text-center order-3 md:order-none w-full md:w-auto">
          <span className="num text-lg font-semibold">{timeStr}</span>
          <span className="text-[10px] text-ink-muted ml-2 tracking-wider">{dateStr}</span>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {loc.data?.satellites != null && (
            <span className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs bg-white/[0.04] ring-1 ring-white/10 text-ink-soft">
              <Satellite size={12} className="text-aurora-teal" /> GPS {loc.data.satellites}
            </span>
          )}
          {env.payload?.external_temp_c != null && (
            <span className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs bg-white/[0.04] ring-1 ring-white/10 text-ink-soft">
              <Thermometer size={12} /> {fmtTemp(env.payload.external_temp_c)}
            </span>
          )}
          <span className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs bg-white/[0.04] ring-1 ring-white/10 text-ink-soft">
            <BatteryCharging size={12} className={battery.payload?.charging ? 'text-status-green' : ''} />
            {battery.payload?.voltage != null ? fmtVolt(battery.payload.voltage) : DASH}
          </span>
          {isDemo ? (
            <a href="https://github.com/andrewdunn358-dev/bongo-control" target="_blank" rel="noreferrer">
              <StatusPill tone="purple" data-testid={NAV.wsIndicator}>DEMO · view source</StatusPill>
            </a>
          ) : (
            <StatusPill tone={wsConnected ? 'teal' : 'red'} data-testid={NAV.wsIndicator}>{wsConnected ? 'LIVE' : 'OFFLINE'}</StatusPill>
          )}
        </div>
      </header>

      <main className="pb-28 pt-6 px-4 md:px-6">{children}</main>

      {/* Bottom dock - navigation, on every screen size (not just
          mobile) - matches the reference's actual nav placement, a
          floating dock rather than a sidebar. */}
      <nav className="fixed bottom-4 inset-x-4 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 z-40 md:w-auto">
        <ul className="flex overflow-x-auto scrollbar-hide gap-1 rounded-2xl bg-black/50 backdrop-blur-md ring-1 ring-white/10 px-2 py-2 shadow-2xl md:justify-center">
          {LINKS.map(({ to, short, icon: Icon, testId, end }) => (
            <li key={to} className="shrink-0">
              <NavLink
                to={to}
                end={end}
                data-testid={`${testId}-mobile`}
                className={({ isActive }) =>
                  cn(
                    'flex flex-col items-center justify-center gap-0.5 py-1.5 px-3 rounded-xl text-[10px] transition-colors',
                    isActive ? 'text-brand-orange bg-brand-orange/15' : 'text-ink-muted hover:text-ink-soft',
                  )
                }
              >
                <Icon size={17} />
                <span className="leading-none">{short}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
