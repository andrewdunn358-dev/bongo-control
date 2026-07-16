import { useEffect, useRef, useState } from "react";
import type { TelemetryState } from "../types/telemetry";

export interface AppEvent {
  id: string;
  text: string;
  timestamp: number;
}

const MAX_EVENTS = 8;
const BATTERY_MILESTONES = [20, 50, 80, 100];

/**
 * Derives a "Recent Events" feed entirely on the client by diffing
 * successive telemetry snapshots — no backend/event-log infrastructure
 * needed for this yet (per Sprint Pack 001 scope). Detects:
 *   - loads switching on/off
 *   - battery crossing round milestones (20/50/80/100%)
 *   - connectivity flipping online/offline
 *
 * This intentionally lives in the frontend only; if/when a persisted
 * event log is built server-side later, this hook is what gets replaced.
 */
export function useRecentEvents(state: TelemetryState): AppEvent[] {
  const [events, setEvents] = useState<AppEvent[]>([]);
  const prevRef = useRef<TelemetryState>({});

  useEffect(() => {
    const prev = prevRef.current;
    const next: AppEvent[] = [];
    const now = Date.now() / 1000;

    // Load toggles
    const prevLoads = prev.energy?.payload.loads;
    const currLoads = state.energy?.payload.loads;
    if (prevLoads && currLoads) {
      for (const [name, on] of Object.entries(currLoads)) {
        if (prevLoads[name] !== undefined && prevLoads[name] !== on) {
          const label = name.replace(/_/g, " ");
          next.push({ id: `load-${name}-${now}`, text: `${label} switched ${on ? "on" : "off"}`, timestamp: now });
        }
      }
    }

    // Battery milestone crossings
    const prevSoc = prev.battery?.payload.soc_pct;
    const currSoc = state.battery?.payload.soc_pct;
    if (prevSoc !== undefined && currSoc !== undefined) {
      for (const milestone of BATTERY_MILESTONES) {
        if (prevSoc < milestone && currSoc >= milestone) {
          next.push({ id: `soc-${milestone}-${now}`, text: `Battery reached ${milestone}%`, timestamp: now });
        }
        if (prevSoc > milestone && currSoc <= milestone) {
          next.push({ id: `soc-drop-${milestone}-${now}`, text: `Battery dropped below ${milestone}%`, timestamp: now });
        }
      }
    }

    // Connectivity flips
    const prevOnline = prev.connectivity?.payload.online;
    const currOnline = state.connectivity?.payload.online;
    if (prevOnline !== undefined && currOnline !== undefined && prevOnline !== currOnline) {
      next.push({ id: `conn-${now}`, text: currOnline ? "Back online" : "Connection lost", timestamp: now });
    }

    if (next.length > 0) {
      setEvents((existing) => [...next, ...existing].slice(0, MAX_EVENTS));
    }

    prevRef.current = state;
  }, [state]);

  return events;
}
