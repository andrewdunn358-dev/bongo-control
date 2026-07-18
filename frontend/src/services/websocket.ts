// Single WebSocket connection to the backend's Telemetry Bus stream.
// This is the ONLY place in the frontend that knows a websocket exists —
// everything else consumes data through TelemetryContext.

import type { TelemetryMessage } from "../types/telemetry";

// Same-origin, matching the page's own protocol (ws:// on http, wss://
// on https) - nginx proxies /ws through to the backend. Works on the
// van's LAN offline and through a remote HTTPS tunnel, unchanged.
const WS_URL = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws/telemetry`;

type MessageHandler = (message: TelemetryMessage) => void;

export class TelemetryClient {
  private socket: WebSocket | null = null;
  private handlers = new Set<MessageHandler>();
  private reconnectDelayMs = 1000;
  private readonly maxReconnectDelayMs = 15000;
  private shouldReconnect = true;
  private statusHandlers = new Set<(connected: boolean) => void>();

  connect(): void {
    this.shouldReconnect = true;
    this.open();
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.socket?.close();
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onStatusChange(handler: (connected: boolean) => void): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  private open(): void {
    this.socket = new WebSocket(WS_URL);

    this.socket.onopen = () => {
      this.reconnectDelayMs = 1000;
      this.statusHandlers.forEach((h) => h(true));
    };

    this.socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as TelemetryMessage;
        this.handlers.forEach((h) => h(message));
      } catch (err) {
        console.error("Failed to parse telemetry message", err);
      }
    };

    this.socket.onclose = () => {
      this.statusHandlers.forEach((h) => h(false));
      if (this.shouldReconnect) {
        setTimeout(() => this.open(), this.reconnectDelayMs);
        this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 1.5, this.maxReconnectDelayMs);
      }
    };

    this.socket.onerror = () => {
      this.socket?.close();
    };
  }
}

export const telemetryClient = new TelemetryClient();
