import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ShieldCheck,
  AlertTriangle,
  XCircle,
  Satellite,
  Flame,
  Cable,
  Maximize2,
} from 'lucide-react';

import { StatusPill } from '@/components/primitives/StatusPill';
import {
  VanOSBattery,
  VanOSSolar,
  VanOSThermometer,
  VanOSWeather,
} from '@/components/VanOSGraphics';
import { api } from '@/lib/api';
import {
  useBattery,
  useSolar,
  useEnergy,
  useEnvironment,
  useWeather,
  useConnected,
  useSparkBuffer,
} from '@/lib/telemetry';
import { fmtVolt, fmtWatt, fmtTemp, fmtPct, DASH } from '@/lib/format';
import type { BatteryPayload, SolarPayload } from '@/lib/types';

const STATUS_META = {
  green: {
    label: 'READY',
    icon: ShieldCheck,
    colour: '#32d583',
  },
  amber: {
    label: 'ATTENTION',
    icon: AlertTriangle,
    colour: '#f2b84b',
  },
  red: {
    label: 'CRITICAL',
    icon: XCircle,
    colour: '#f0645b',
  },
} as const;

function useClock(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return now;
}


function MiniSpark({
  data,
  stroke,
  minRange,
}: {
  data: number[];
  stroke: string;
  minRange: number;
}) {
  if (data.length < 2) {
    return <div className="h-6" />;
  }

  const lo = Math.min(...data);
  const hi = Math.max(...data);
  const span = Math.max(minRange, hi - lo);

  const points = data
    .map(
      (value, index) =>
        `${(index / (data.length - 1)) * 300},${
          34 - Math.min(30, Math.max(2, ((value - lo) / span) * 30))
        }`,
    )
    .join(' ');

  return (
    <svg
      className="van-spark"
      width="100%"
      height="38"
      viewBox="0 0 300 38"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

function Panel({
  children,
  className = '',
  raised = false,
}: {
  children: React.ReactNode;
  className?: string;
  raised?: boolean;
}) {
  return (
    <div
      className={[
        'relative overflow-hidden rounded-[8px] border',
        raised
          ? 'border-[#304050] bg-[#121a23] shadow-[0_8px_30px_rgba(0,0,0,.22)]'
          : 'border-[#202b36] bg-[#0d131a]',
        className,
      ].join(' ')}
    >
      {children}
    </div>
  );
}

function MetricLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#647382]">
      {children}
    </div>
  );
}

export function CockpitDashboard() {
  const { data: brief } = useQuery({
    queryKey: ['mission-brief'],
    queryFn: api.missionBrief,
    refetchInterval: 30_000,
  });

  const battery = useBattery();
  const solar = useSolar();
  const energy = useEnergy();
  const env = useEnvironment();
  const weather = useWeather();
  const connected = useConnected();
  const now = useClock();

  const loc = useQuery({
    queryKey: ['location'],
    queryFn: api.location,
    retry: false,
  });

  const heater = useQuery({
    queryKey: ['heater'],
    queryFn: api.heater,
    refetchInterval: 5_000,
    retry: false,
  });

  const fuel = useQuery({
    queryKey: ['heater-fuel'],
    queryFn: api.heaterFuel,
    refetchInterval: 60_000,
    retry: false,
  });

  const solarSeries = useSparkBuffer<SolarPayload>('solar', (p) => p.watts);
  const voltSeries = useSparkBuffer<BatteryPayload>('battery', (p) => p.voltage);

  const status = STATUS_META[brief?.status ?? 'green'];
  const StatusIcon = status.icon;

  const bp = battery.payload;
  const netW = energy.payload?.net_watts ?? null;
  const ratio = weather.payload?.tomorrow_vs_today_radiation_ratio ?? null;

  const batteryState =
    bp == null
      ? DASH
      : bp.charging
        ? 'Charging'
        : bp.current_a != null && Math.abs(bp.current_a) < 0.2
          ? 'Resting'
          : 'Discharging';

  const hs = heater.data?.state ?? {};
  const heaterOn = hs.state === 0x8 || Boolean(hs.igniting);

  const heaterLabel = !heater.data?.available
    ? 'No signal'
    : hs.error_code
      ? 'Fault'
      : hs.igniting
        ? 'Igniting'
        : hs.cooling_down
          ? 'Cooling down'
          : heaterOn
            ? 'Heating'
            : 'Off';

  const topRec = brief?.recommendations?.[0];
  const topPred = brief?.predictions?.[0];

  const cameraTimestamp = Math.floor(now.getTime() / 5000) * 5000;

  return (
    <div className="van-cockpit mx-auto w-full max-w-[1280px] space-y-5 pb-8">
      {/* ============================================================
          STATUS
         ============================================================ */}
      <Link to="/overview" className="block">
        <Panel raised className="van-status px-5 py-4 transition-colors duration-150 hover:border-[#3b9cff]/60">
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div className="flex min-w-0 items-center gap-4">
              <StatusIcon
                size={34}
                strokeWidth={2}
                style={{ color: status.colour }}
                className="shrink-0"
              />

              <div className="min-w-0">
                <div
                  className="text-[26px] font-bold leading-none tracking-[-0.03em]"
                  style={{ color: status.colour }}
                >
                  {status.label}
                </div>

                <div className="mt-1 truncate text-[13px] text-[#9aa8b6]">
                  {brief?.summary || 'Assembling mission brief…'}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-7 gap-y-3">
              <div>
                <MetricLabel>
                  <span className="inline-flex items-center gap-1">
                    <Satellite size={10} /> GPS
                  </span>
                </MetricLabel>
                <div className="mt-0.5 text-[13px] font-medium text-[#f1f5f9]">
                  {loc.data?.satellites != null
                    ? `${loc.data.satellites} sats`
                    : DASH}
                  {loc.data?.hdop != null && (
                    <span className="text-[#647382]">
                      {' '}· HDOP {loc.data.hdop.toFixed(1)}
                    </span>
                  )}
                </div>
              </div>

              <div>
                <MetricLabel>
                  <span className="inline-flex items-center gap-1">
                    <Cable size={10} /> Network
                  </span>
                </MetricLabel>
                {/* The Pi is wired to the van router over ETHERNET, not
                    Wi-Fi - no SSID, no signal strength, no Wi-Fi icon.
                    Reachability comes from the live websocket: if this
                    page is receiving telemetry the Pi-to-browser path is
                    demonstrably up. The CONNECTIVITY telemetry domain is
                    deliberately NOT used here - nothing in the backend
                    publishes it (only plugins/simulation does), so it
                    reported "Offline" permanently on the real van. */}
                <div className="mt-0.5 text-[13px] font-medium text-[#f1f5f9]">
                  {connected ? (
                    <>Ethernet <span className="text-[#647382]">· Connected</span></>
                  ) : (
                    <span className="text-[#647382]">Not reachable</span>
                  )}
                </div>
              </div>

              <div>
                <MetricLabel>Time</MetricLabel>
                <div className="mt-0.5 font-mono text-[13px] font-medium text-[#f1f5f9]">
                  {now.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>

              <StatusPill tone={connected ? 'teal' : 'red'}>
                {connected ? 'LIVE' : 'OFFLINE'}
              </StatusPill>
            </div>
          </div>
        </Panel>
      </Link>

      {/* ============================================================
          MAIN COCKPIT
          40% power / 60% camera
         ============================================================ */}
      <div className="van-main grid min-h-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(300px,40fr)_minmax(0,60fr)]">
        {/* POWER COLUMN */}
        <div className="grid min-h-0 gap-4 lg:grid-rows-2">
          {/* BATTERY */}
          <Link to="/power" className="block min-h-0">
            <Panel
              raised
              className="van-powercard group flex h-full min-h-[250px] flex-col p-5 transition-colors duration-150 hover:border-[#3b9cff]/70"
            >
              <div className="flex items-start justify-between">
                <MetricLabel>Battery</MetricLabel>
                <VanOSBattery soc={bp?.soc_pct} charging={bp?.charging} />
              </div>

              <div className="mt-1 flex items-end gap-3">
                <div className="font-mono text-[38px] font-bold leading-none tracking-[-0.05em] text-[#f1f5f9]">
                  {bp?.soc_pct != null ? `${Math.round(bp.soc_pct)}%` : DASH}
                </div>
                <div className="mb-1 font-mono text-[16px] text-[#9aa8b6]">
                  {fmtVolt(bp?.voltage)}
                </div>
              </div>

              {bp?.soc_pct != null && (
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#202b36]">
                  <div
                    className="h-full rounded-full transition-[width] duration-700"
                    style={{
                      width: `${Math.max(2, Math.min(100, bp.soc_pct))}%`,
                      background:
                        bp.soc_pct < 50
                          ? '#f0645b'
                          : bp.soc_pct < 70
                            ? '#f2b84b'
                            : '#32d583',
                    }}
                  />
                </div>
              )}

              <div className="mt-4 flex items-baseline justify-between gap-3">
                <div className="text-[13px] text-[#9aa8b6]">
                  {batteryState}
                  {bp?.charging_power_w != null && (
                    <span className="text-[#647382]">
                      {' '}· {fmtWatt(bp.charging_power_w)} in
                    </span>
                  )}
                </div>

                {netW != null && (
                  <div
                    className={[
                      'font-mono text-[15px] font-semibold',
                      netW > 0
                        ? 'text-[#32d583]'
                        : netW < 0
                          ? 'text-[#f2b84b]'
                          : 'text-[#9aa8b6]',
                    ].join(' ')}
                  >
                    {netW > 0 ? '+' : ''}
                    {fmtWatt(netW)} net
                  </div>
                )}
              </div>

              {netW != null && (
                <div className="mt-1 text-[11px] text-[#647382]">
                  {netW > 0
                    ? 'Making more than using'
                    : netW < 0
                      ? 'Using more than making'
                      : 'Balanced'}
                  {' '}· in {fmtWatt(energy.payload?.solar_watts)}, out{' '}
                  {fmtWatt(energy.payload?.load_watts)}
                </div>
              )}

              <div className="van-sparkwrap mt-auto pt-4">
                <MiniSpark
                  data={voltSeries}
                  stroke="#3b9cff"
                  minRange={0.4}
                />
              </div>
            </Panel>
          </Link>

          {/* SOLAR */}
          <Link to="/weather" className="block min-h-0">
            <Panel
              raised
              className="van-powercard group flex h-full min-h-[250px] flex-col p-5 transition-colors duration-150 hover:border-[#3b9cff]/70"
            >
              <div className="flex items-start justify-between">
                <MetricLabel>Solar</MetricLabel>
                <VanOSSolar />
              </div>

              <div className="mt-1 flex items-end gap-3">
                <div className="font-mono text-[38px] font-bold leading-none tracking-[-0.05em] text-[#f1f5f9]">
                  {fmtWatt(solar.payload?.watts)}
                </div>
              </div>

              <div className="mt-4 text-[13px] text-[#9aa8b6]">
                Peak today {fmtWatt(solar.payload?.peak_today_watts)}
              </div>

              <div className="mt-1 text-[11px] uppercase tracking-[0.12em] text-[#647382]">
                {(solar.payload?.charge_state || 'off').toUpperCase()}
              </div>

              {ratio != null && (
                <div className="mt-4 border-t border-[#202b36] pt-3 text-[12px] text-[#9aa8b6]">
                  <span className="text-[#647382]">Tomorrow</span>{' '}
                  <span className={ratio >= 1 ? 'text-[#32d583]' : 'text-[#f2b84b]'}>
                    {ratio >= 1 ? '↑' : '↓'} {Math.round(ratio * 100)}%
                  </span>{' '}
                  <span className="text-[#647382]">of today's radiation</span>
                </div>
              )}

              <div className="van-sparkwrap mt-auto pt-4">
                <MiniSpark
                  data={solarSeries}
                  stroke="#f5c451"
                  minRange={25}
                />
              </div>
            </Panel>
          </Link>
        </div>

        {/* CAMERA CENTREPIECE */}
        <Link to="/camera" className="block min-h-0">
          <Panel
            raised
            className="van-camera relative h-full min-h-[520px] overflow-hidden p-0 transition-colors duration-150 hover:border-[#3b9cff]/70"
          >
            <img
              src={api.cameraSnapshotUrl(cameraTimestamp)}
              alt="Van camera"
              className="absolute inset-0 h-full w-full object-cover"
              onError={(event) => {
                (event.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />

            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/70 to-transparent" />

            <div className="absolute left-4 top-4 flex items-center gap-2 rounded-md border border-white/10 bg-black/55 px-3 py-2 backdrop-blur-sm">
              <span
                className={[
                  'h-2 w-2 rounded-full',
                  connected ? 'bg-[#32d583]' : 'bg-[#f0645b]',
                ].join(' ')}
              />
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white">
                {connected ? 'LIVE' : 'OFFLINE'}
              </span>
              <span className="text-[11px] text-white/55">Van Camera</span>
            </div>

            <div className="absolute bottom-4 left-4">
              <div className="text-[10px] uppercase tracking-[0.16em] text-white/45">
                Van camera
              </div>
              <div className="mt-1 font-mono text-[12px] text-white/75">
                {now.toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </div>
            </div>

            <div className="absolute bottom-4 right-4 rounded-md border border-white/10 bg-black/45 p-2 text-white/75">
              <Maximize2 size={14} />
            </div>
          </Panel>
        </Link>
      </div>

      {/* ============================================================
          INTELLIGENCE
         ============================================================ */}
      <Link to="/overview" className="block">
        <Panel
          raised
          className="transition-colors duration-150 hover:border-[#3b9cff]/70"
        >
          <div className="van-brief grid gap-5 p-5 md:grid-cols-[minmax(0,1fr)_minmax(240px,320px)] md:items-center">
            <div className="min-w-0">
              <MetricLabel>What you need to know</MetricLabel>

              <div className="mt-2 text-[17px] font-semibold leading-6 text-[#f1f5f9]">
                {brief?.summary || 'Assembling mission brief…'}
              </div>

              {topRec && (
                <div className="mt-4 border-l-2 border-[#3b9cff] pl-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#3b9cff]">
                    Recommendation
                  </div>
                  <div className="mt-1 text-[13px] leading-5 text-[#9aa8b6]">
                    {topRec}
                  </div>
                </div>
              )}
            </div>

            {topPred && (
              <div className="border-l border-[#202b36] pl-5 md:text-right">
                <MetricLabel>{topPred.label}</MetricLabel>
                <div className="mt-2 font-mono text-[24px] font-semibold text-[#f1f5f9]">
                  {topPred.value == null
                    ? DASH
                    : `${topPred.value}${topPred.unit ? ` ${topPred.unit}` : ''}`}
                </div>
              </div>
            )}
          </div>
        </Panel>
      </Link>

      {/* ============================================================
          SUPPORTING INFORMATION
         ============================================================ */}
      <div className="van-support grid gap-4 md:grid-cols-3">
        <Link to="/weather" className="block">
          <Panel className="van-supportcard h-full p-4 transition-colors duration-150 hover:border-[#304050]">
            <div className="flex items-center justify-between">
              <MetricLabel>Environment</MetricLabel>
              <VanOSWeather condition={weather.payload?.current_weather_description} size={26} />
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <div>
                <div className="flex items-center gap-1.5">
                  <VanOSThermometer temperature={env.payload?.internal_temp_c} size={20} />
                  <span className="font-mono text-[20px] font-semibold text-[#f1f5f9]">
                    {fmtTemp(env.payload?.internal_temp_c)}
                  </span>
                </div>
                <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-[#647382]">
                  Inside
                </div>
              </div>

              <div>
                <div className="font-mono text-[20px] font-semibold text-[#f1f5f9]">
                  {fmtTemp(env.payload?.external_temp_c)}
                </div>
                <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-[#647382]">
                  Outside
                </div>
              </div>

              <div className="min-w-0">
                <div className="font-mono text-[15px] text-[#9aa8b6]">
                  {fmtTemp(weather.payload?.current_temp_c)}
                </div>
                <div className="mt-1 truncate text-[10px] text-[#647382]">
                  {weather.payload?.current_weather_description || 'No reading'}
                </div>
              </div>
            </div>
          </Panel>
        </Link>

        <Link to="/heater" className="block">
          <Panel className="van-supportcard h-full p-4 transition-colors duration-150 hover:border-[#304050]">
            <div className="flex items-center justify-between">
              <MetricLabel>Heater</MetricLabel>
              <Flame
                size={16}
                className={heaterOn ? 'text-[#f2b84b]' : 'text-[#647382]'}
              />
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <StatusPill
                tone={hs.error_code ? 'red' : heaterOn ? 'amber' : 'slate'}
              >
                {heaterLabel}
              </StatusPill>

              {hs.target != null && (
                <span className="font-mono text-[15px] text-[#9aa8b6]">
                  {hs.target}{hs.mode === 2 ? '°C' : ''}
                </span>
              )}
            </div>

            <div className="mt-3 text-[11px] text-[#647382]">
              Body {fmtTemp(hs.body_temperature_c)} · Cabin{' '}
              {fmtTemp(hs.cabin_temperature_c)}
            </div>

            {fuel.data?.tank_remaining_litres != null &&
              fuel.data?.tank_litres != null && (
                <div className="mt-1 text-[11px] text-[#647382]">
                  Fuel ~
                  {fmtPct(
                    (fuel.data.tank_remaining_litres /
                      fuel.data.tank_litres) *
                      100,
                  )}{' '}
                  estimated
                </div>
              )}
          </Panel>
        </Link>

        <Link to="/nearby" className="block">
          <Panel className="van-supportcard h-full p-4 transition-colors duration-150 hover:border-[#304050]">
            <div className="flex items-center justify-between">
              <MetricLabel>Location</MetricLabel>
              <Satellite size={16} className="text-[#3b9cff]" />
            </div>

            <div className="mt-4 flex items-baseline gap-2">
              <span className="font-mono text-[22px] font-semibold text-[#f1f5f9]">
                {loc.data?.satellites ?? DASH}
              </span>
              <span className="text-[12px] text-[#9aa8b6]">satellites</span>
            </div>

            {loc.data?.hdop != null && (
              <div className="mt-1 text-[11px] text-[#647382]">
                HDOP {loc.data.hdop.toFixed(1)}
              </div>
            )}

            {loc.data?.latitude != null && loc.data?.longitude != null && (
              <div className="mt-3 font-mono text-[11px] text-[#647382]">
                {loc.data.latitude.toFixed(4)}°, {loc.data.longitude.toFixed(4)}°
              </div>
            )}
          </Panel>
        </Link>
      </div>
    </div>
  );
}
