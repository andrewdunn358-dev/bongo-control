import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Info, AlertTriangle, AlertCircle, X } from "lucide-react";
import { useTelemetry, type NotificationEntry } from "../../context/TelemetryContext";
import type { NotificationLevel } from "../../types/telemetry";

const AUTO_DISMISS_MS = 6000;

const levelConfig: Record<NotificationLevel, { icon: typeof CheckCircle2; color: string; border: string }> = {
  success: { icon: CheckCircle2, color: "text-battery", border: "border-t-battery/60" },
  info: { icon: Info, color: "text-text-secondary", border: "border-t-transparent" },
  warning: { icon: AlertTriangle, color: "text-solar", border: "border-t-solar/60" },
  error: { icon: AlertCircle, color: "text-alert", border: "border-t-alert/60" },
};

/**
 * Transient toast popups for live notifications (battery alerts, plugin
 * connect/disconnect, etc). Mounted once at the app root. The full
 * persistent history lives on Settings > Notifications — this is just
 * the "something just happened" surface.
 */
export default function NotificationToaster() {
  const { notifications } = useTelemetry();
  const [visible, setVisible] = useState<NotificationEntry[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (notifications.length === 0) return;
    const newest = notifications[0];
    setVisible((prev) => (prev.some((n) => n.id === newest.id) ? prev : [newest, ...prev].slice(0, 3)));

    const timer = setTimeout(() => {
      setDismissed((prev) => new Set(prev).add(newest.id));
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifications[0]?.id]);

  const shown = visible.filter((n) => !dismissed.has(n.id));

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-4 md:left-auto md:right-4 md:items-end">
      <AnimatePresence initial={false}>
        {shown.map((entry) => {
          const level = entry.message.payload.level;
          const { icon: Icon, color, border } = levelConfig[level];
          return (
            <motion.div
              key={entry.id}
              initial={{ opacity: 0, y: -12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl2 border-t-2 bg-surface-card p-4 shadow-card ${border}`}
            >
              <Icon size={18} className={`mt-0.5 shrink-0 ${color}`} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-text-primary">{entry.message.payload.title}</div>
                <div className="text-sm text-text-secondary">{entry.message.payload.message}</div>
              </div>
              <button
                onClick={() => setDismissed((prev) => new Set(prev).add(entry.id))}
                className="shrink-0 text-text-muted transition-colors hover:text-text-primary"
                aria-label="Dismiss"
              >
                <X size={16} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
