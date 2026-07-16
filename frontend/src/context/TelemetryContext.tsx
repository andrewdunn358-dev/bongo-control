// Provides live telemetry to every page via one WebSocket connection.
// Pages/components read this context and never touch the socket or
// know whether data originates from simulation or real hardware.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { telemetryClient } from "../services/websocket";
import type { NotificationPayload, TelemetryMessage, TelemetryState } from "../types/telemetry";

const MAX_NOTIFICATIONS = 20;

export interface NotificationEntry {
  id: string;
  message: TelemetryMessage<NotificationPayload>;
}

interface TelemetryContextValue {
  state: TelemetryState;
  connected: boolean;
  // Notifications are a stream of discrete events, not a single
  // overwritable "latest" snapshot like every other domain — so they
  // get their own rolling list rather than living in `state.notification`.
  notifications: NotificationEntry[];
}

const TelemetryContext = createContext<TelemetryContextValue>({
  state: {},
  connected: false,
  notifications: [],
});

export function TelemetryProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TelemetryState>({});
  const [connected, setConnected] = useState(false);
  const [notifications, setNotifications] = useState<NotificationEntry[]>([]);

  useEffect(() => {
    const unsubscribeMessage = telemetryClient.onMessage((message) => {
      if (message.domain === "notification") {
        const entry: NotificationEntry = {
          id: `${message.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
          message: message as unknown as TelemetryMessage<NotificationPayload>,
        };
        setNotifications((prev) => [entry, ...prev].slice(0, MAX_NOTIFICATIONS));
        return;
      }
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

  return <TelemetryContext.Provider value={{ state, connected, notifications }}>{children}</TelemetryContext.Provider>;
}

export function useTelemetry(): TelemetryContextValue {
  return useContext(TelemetryContext);
}
