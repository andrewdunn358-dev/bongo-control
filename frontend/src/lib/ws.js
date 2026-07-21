import { useEffect, useRef, useState } from 'react';
import { wsUrl } from '@/lib/api';

/**
 * useTelemetry — connects to /api/ws/telemetry, keeps last frame + a
 * rolling ring buffer for sparklines. Reconnects with backoff on drop.
 */
export function useTelemetry({ bufferSize = 60 } = {}) {
  const [frame, setFrame] = useState(null);
  const [connected, setConnected] = useState(false);
  const [buffer, setBuffer] = useState([]);
  const bufferRef = useRef([]);
  const wsRef = useRef(null);
  const retryRef = useRef(0);
  const closedRef = useRef(false);

  useEffect(() => {
    closedRef.current = false;
    const connect = () => {
      const url = wsUrl('/api/ws/telemetry');
      let socket;
      try {
        socket = new WebSocket(url);
      } catch (e) {
        scheduleRetry();
        return;
      }
      wsRef.current = socket;

      socket.onopen = () => {
        setConnected(true);
        retryRef.current = 0;
      };
      socket.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          setFrame(data);
          const next = [...bufferRef.current, data].slice(-bufferSize);
          bufferRef.current = next;
          setBuffer(next);
        } catch (_) {
          /* ignore */
        }
      };
      socket.onclose = () => {
        setConnected(false);
        if (!closedRef.current) scheduleRetry();
      };
      socket.onerror = () => {
        try { socket.close(); } catch (_) { /* noop */ }
      };
    };

    const scheduleRetry = () => {
      const attempt = ++retryRef.current;
      const delay = Math.min(1000 * 2 ** Math.min(attempt, 5), 8000);
      setTimeout(() => {
        if (!closedRef.current) connect();
      }, delay);
    };

    connect();
    return () => {
      closedRef.current = true;
      try { wsRef.current?.close(); } catch (_) { /* noop */ }
    };
  }, [bufferSize]);

  return { frame, connected, buffer };
}
