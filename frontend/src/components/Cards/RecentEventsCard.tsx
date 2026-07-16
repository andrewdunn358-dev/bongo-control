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
        <ul className="space-y-2.5">
          <AnimatePresence initial={false}>
            {events.map((event) => (
              <motion.li
                key={event.id}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-baseline gap-3 text-sm"
              >
                <span className="font-mono text-xs tabular-nums text-text-muted">
                  {new Date(event.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="text-text-primary">{event.text}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </Card>
  );
}
