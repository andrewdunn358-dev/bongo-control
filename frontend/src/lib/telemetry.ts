import { useEffect, useRef, useSyncExternalStore } from 'react';
import { TELEMETRY_WS_PATH } from '@/lib/config';
import type {
  BatteryPayload,
  ConnectivityPayload,
  EnergyPayload,
  EnvironmentPayload,
  SolarPayload,
  SystemPayload,
  TelemetryDomain,
  TelemetryMessage,
  TelemetrySource,
  WeatherPayload,
} from '@/lib/types';

/**
 * Telemetry store — the backend sends one WS message per domain, not a
 * combined frame. We keep a map of `domain -> latest message` and a small
 * ring buffer per domain for sparklines.
 */
type DomainMap = Partial<Record<TelemetryDomain, TelemetryMessage>>;
type DomainHistory = Partial<Record<TelemetryDomain, TelemetryMessage[]>>;

interface Store {
  connected: boolean;
  latest: DomainMap;
  history: DomainHistory;
  /** Domains whose latest source is 'simulation' — drives the sim banner. */
  simulatedDomains: TelemetryDomain[];
}

const BUFFER = 60;

let state: Store = {
  connected: false,
  latest: {},
  history: {},
  simulatedDomains: [],
};

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const setConnected = (c: boolean) => {
  if (state.connected === c) return;
  state = { ...state, connected: c };
  emit();
};

const ingest = (msg: TelemetryMessage) => {
  const nextLatest: DomainMap = { ...state.latest, [msg.domain]: msg };
  const prev = state.history[msg.domain] || [];
  const nextHistory: DomainHistory = {
    ...state.history,
    [msg.domain]: [...prev, msg].slice(-BUFFER),
  };
  const simulatedDomains = (Object.keys(nextLatest) as TelemetryDomain[]).filter(
    (d) => (nextLatest[d] as TelemetryMessage | undefined)?.source === 'simulation',
  );
  state = { ...state, latest: nextLatest, history: nextHistory, simulatedDomains };
  emit();
};

let ws: WebSocket | null = null;
let retry = 0;
let closed = false;

function connect() {
  const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${TELEMETRY_WS_PATH}`;
  try {
    ws = new WebSocket(url);
  } catch {
    scheduleRetry();
    return;
  }
  ws.onopen = () => {
    retry = 0;
    setConnected(true);
  };
  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data && typeof data === 'object' && 'domain' in data && 'payload' in data) {
        ingest(data as TelemetryMessage);
      }
    } catch {
      /* ignore malformed */
    }
  };
  ws.onclose = () => {
    setConnected(false);
    if (!closed) scheduleRetry();
  };
  ws.onerror = () => {
    try { ws?.close(); } catch { /* ignore */ }
  };
}

function scheduleRetry() {
  const attempt = ++retry;
  const delay = Math.min(1000 * 2 ** Math.min(attempt, 5), 8000);
  setTimeout(() => { if (!closed) connect(); }, delay);
}

/** Idempotent — first call boots the socket. */
export function startTelemetry() {
  if (ws) return;
  closed = false;
  connect();
}

export function stopTelemetry() {
  closed = true;
  try { ws?.close(); } catch { /* ignore */ }
  ws = null;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const snapshot = () => state;

export function useTelemetry() {
  useEffect(() => { startTelemetry(); }, []);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Typed accessor helpers */
export function useDomain<T>(domain: TelemetryDomain): {
  payload: T | undefined;
  source: TelemetrySource | undefined;
  timestamp: number | undefined;
  history: TelemetryMessage<T>[];
} {
  const s = useTelemetry();
  const msg = s.latest[domain] as TelemetryMessage<T> | undefined;
  const history = (s.history[domain] || []) as TelemetryMessage<T>[];
  return {
    payload: msg?.payload,
    source: msg?.source,
    timestamp: msg?.timestamp,
    history,
  };
}

export const useBattery = () => useDomain<BatteryPayload>('battery');
export const useSolar = () => useDomain<SolarPayload>('solar');
export const useEnergy = () => useDomain<EnergyPayload>('energy');
export const useEnvironment = () => useDomain<EnvironmentPayload>('environment');
export const useWeather = () => useDomain<WeatherPayload>('weather');
export const useConnectivity = () => useDomain<ConnectivityPayload>('connectivity');
export const useSystem = () => useDomain<SystemPayload>('system');

/**
 * A stable, sparkline-friendly buffer of `key(payload)` values for a domain.
 * Returns numbers; entries whose key returns null are simply dropped —
 * we do NOT fabricate values to fill gaps.
 */
export function useSparkBuffer<T>(domain: TelemetryDomain, key: (p: T) => number | null | undefined): number[] {
  const s = useTelemetry();
  const hist = (s.history[domain] || []) as TelemetryMessage<T>[];
  const out: number[] = [];
  for (const m of hist) {
    const v = key(m.payload);
    if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
  }
  return out;
}
