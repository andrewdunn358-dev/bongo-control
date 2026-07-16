import { ListTree } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import Card from "./Card";
import { useTelemetry } from "../../context/TelemetryContext";
import { useRecentEvents } from "../../hooks/useRecentEvents";

export default function RecentEventsCard({ index = 0 }: { index?: number }) {
  const { state } = useTelemetry();
  const events = useRecentEvents(state);

  return (
    <Card label="Recent Events" icon={<ListTree size={14} />} index={index}>
      {events.length === 0 ? (
        <span className="text-sm text-text-muted">No events yet — this fills in as things change.</span>
      ) : (
        <ul className="space-y-0">
          <AnimatePresence initial={false}>
            {events.map((event, i) => (
              <motion.li
                key={event.id}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="relative flex gap-3 pb-4 pl-1 last:pb-0"
              >
                {/* timeline rail */}
                <div className="flex flex-col items-center">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-battery" />
                  {i < events.length - 1 && <span className="w-px flex-1 bg-white/10" />}
                </div>
                <div className="-mt-0.5">
                  <div className="font-mono text-xs tabular-nums text-text-muted">
                    {new Date(event.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                  <div className="text-sm text-text-primary">{event.text}</div>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </Card>
  );
}
