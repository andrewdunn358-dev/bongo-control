import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

interface LiveIndicatorProps {
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

export default function LiveIndicator({ lastUpdated, connected }: LiveIndicatorProps) {
  const reduceMotion = useReducedMotion();
  const [, forceTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => forceTick((n) => n + 1), 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-[0.68rem] font-bold uppercase tracking-[0.18em] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] ${
        connected ? "border-success/25 bg-success/10 text-success" : "border-alert/30 bg-alert/10 text-alert"
      }`}
    >
      <span className="relative flex h-2.5 w-2.5">
        {connected && !reduceMotion && (
          <motion.span
            className="absolute inline-flex h-full w-full rounded-full bg-success"
            animate={{ opacity: [0.55, 0, 0.55], scale: [1, 2.1, 1] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${connected ? "bg-success" : "bg-alert"}`} />
      </span>
      <span>{connected ? "Live" : "Offline"}</span>
      {lastUpdated !== null && connected && <span className="hidden text-white/45 sm:inline">{relativeTime(lastUpdated)}</span>}
    </div>
  );
}
