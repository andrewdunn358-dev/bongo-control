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
  LineChart,
  Route,
  Satellite,
  SignalHigh,
  Thermometer,
  BatteryCharging,
  Sparkles,
  Radio as RadioIcon,
} from 'lucide-react';
import { StatusPill } from '@/components/primitives/StatusPill';
import { NAV } from '@/constants/testIds';
import { cn } from '@/lib/utils';
import { isDemo } from '@/lib/demo';
import { api } from '@/lib/api';
import { useBattery, useEnvironment } from '@/lib/telemetry';
import { fmtVolt, fmtTemp, DASH } from '@/lib/format';

// `letter` used to live here too - the "V" placeholder shown before
// there was a real logo. Removed with it; the badge is brand-mark.png now.
const BRAND = { sub: isDemo ? 'campervan dashboard' : 'van cockpit' };
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
  { to: '/power', label: 'Power', short: 'Power', icon: Zap, testId: NAV.power },
  { to: '/weather', label: 'Weather', short: 'Weather', icon: CloudSun, testId: NAV.weather },
  { to: '/nearby', label: 'Nearby', short: 'Nearby', icon: MapPin, testId: NAV.nearby },
  { to: '/coverage', label: 'Coverage', short: 'Coverage', icon: SignalHigh, testId: NAV.coverage },
  { to: '/radio', label: 'Radio', short: 'Radio', icon: RadioIcon, testId: NAV.radio },
  { to: '/switches', label: 'Switches', short: 'Switch', icon: ToggleRight, testId: NAV.switches },
  { to: '/roof', label: 'Roof', short: 'Roof', icon: ChevronsUp, testId: NAV.roof },
  { to: '/camera', label: 'Camera', short: 'Cam', icon: Camera, testId: NAV.camera },
  { to: '/history', label: 'History', short: 'History', icon: LineChart, testId: NAV.history },
  { to: '/trips', label: 'Trips', short: 'Trips', icon: Route, testId: NAV.trips },
  { to: '/chat', label: 'Chat', short: 'Chat', icon: Sparkles, testId: NAV.chat },
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
          only showing numbers this van's actual hardware can back up.

          No backdrop-blur here or on the bottom nav dock below -
          reported "horribly slow" rendering, general navigation,
          everywhere, on a budget Android phone; fine on desktop, the
          classic signature of a GPU-bound cost a desktop shrugs off and
          a phone GPU can't. This bar and the dock are both sticky/
          fixed - permanently on screen, continuously compositing
          against whatever's underneath, on every single screen in the
          app.

          Follow-up fix, real regression from the change above: opacity
          alone (0.85/0.90, not fully opaque) turned out not to be
          enough - scrolled page content faintly showed through as
          ghost text behind the header on a real phone. Blur used to
          smear any bleed-through into an unreadable haze; without it,
          15% see-through was just visible enough to notice and read.
          Both now fully opaque, matching the page's own dark theme
          base colour (--aurora-base's top stop, #0a1628) rather than a
          flat black, so it still blends in as intentional rather than
          switching to a jarring plain dark box. */}
      <header
        data-testid={NAV.root}
        className="sticky top-0 z-40 flex items-center justify-between gap-3 px-4 md:px-6 py-3 bg-[#0a1628] border-b border-white/8 flex-wrap"
      >
        <div data-testid={NAV.brand} className="flex items-center gap-2.5 shrink-0">
          {/* Was a CSS gradient square with the letter "V" in it - a
              placeholder from before there was a real logo. Now
              Frankie's own artwork, cropped to the gold van from the
              crest at the top of it. The crop is the point: the full
              artwork carries a wordmark and a whole photographic
              scene, and at 36px that is an unreadable smudge (checked
              by rendering it, not assumed). The van is the one element
              that still reads at this size, and the wordmark would be
              redundant anyway - "VanOS" is printed as text right
              beside this. Plain <img> so it stays out of the JS bundle
              and is cached by the service worker like any other
              same-origin asset. Corners are rounded by CSS below, so
              the file itself is a plain square. */}
          <img
            src="/brand-mark.png"
            alt=""
            width={36}
            height={36}
            className="h-9 w-9 rounded-xl object-cover shadow-[0_0_14px_rgba(178,97,0,0.4)]"
          />
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
        <ul className="flex overflow-x-auto scrollbar-hide gap-1 rounded-2xl bg-[#0a1628] ring-1 ring-white/10 px-2 py-2 shadow-2xl md:justify-center">
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
