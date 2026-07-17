import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

interface LiveIndicatorProps {
  /** Unix seconds of the most recent reading this indicator represents. */
  lastUpdated: number | null;
  connected: boolean;
}

function relativeTime(unixSeconds: number): string {
  const seconds = Math.round(Date.now() / 1000 - unixSeconds);
  if (seconds < 2) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

/**
 * Small "breathing" live-status pill: a gently pulsing dot (only while
 * actually connected — a still dot when disconnected is itself the
 * signal something's wrong) plus a relative "last updated" timestamp
 * that ticks over on its own every few seconds.
 */
export default function LiveIndicator({ lastUpdated, connected }: LiveIndicatorProps) {
  const reduceMotion = useReducedMotion();
  const [, forceTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => forceTick((n) => n + 1), 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-1.5 text-xs text-text-muted">
      <span className="relative flex h-2 w-2">
        {connected && !reduceMotion && (
          <motion.span
            className="absolute inline-flex h-full w-full rounded-full bg-battery"
            animate={{ opacity: [0.6, 0, 0.6], scale: [1, 1.8, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${connected ? "bg-battery" : "bg-alert"}`} />
      </span>
      <span>{connected ? "Live" : "Disconnected"}</span>
      {lastUpdated !== null && connected && <span>· updated {relativeTime(lastUpdated)}</span>}
    </div>
  );
}
