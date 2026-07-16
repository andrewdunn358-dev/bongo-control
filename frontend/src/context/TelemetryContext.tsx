// Provides live telemetry to every page via one WebSocket connection.
// Pages/components read this context and never touch the socket or
// know whether data originates from simulation or real hardware.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { telemetryClient } from "../services/websocket";
import type { TelemetryState } from "../types/telemetry";

interface TelemetryContextValue {
  state: TelemetryState;
  connected: boolean;
}

const TelemetryContext = createContext<TelemetryContextValue>({
  state: {},
  connected: false,
});

export function TelemetryProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TelemetryState>({});
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const unsubscribeMessage = telemetryClient.onMessage((message) => {
      setState((prev) => ({ ...prev, [message.domain]: message }));
    });
    const unsubscribeStatus = telemetryClient.onStatusChange(setConnected);

    telemetryClient.connect();

    return () => {
      unsubscribeMessage();
      unsubscribeStatus();
      telemetryClient.disconnect();
    };
  }, []);

  return <TelemetryContext.Provider value={{ state, connected }}>{children}</TelemetryContext.Provider>;
}

export function useTelemetry(): TelemetryContextValue {
  return useContext(TelemetryContext);
}
