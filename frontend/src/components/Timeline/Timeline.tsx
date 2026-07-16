import { AnimatePresence, motion } from "framer-motion";

export interface TimelineItem {
  id: string;
  timestamp: number; // unix seconds
  text: string;
}

/**
 * Reusable vertical timeline (connecting rail + dot per entry). Extracted
 * from RecentEventsCard so History and any future event-style list share
 * one implementation instead of duplicating the rail/dot markup.
 */
export default function Timeline({ items, emptyMessage }: { items: TimelineItem[]; emptyMessage: string }) {
  if (items.length === 0) {
    return <span className="text-sm text-text-muted">{emptyMessage}</span>;
  }

  return (
    <ul className="space-y-0">
      <AnimatePresence initial={false}>
        {items.map((item, i) => (
          <motion.li
            key={item.id}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="relative flex gap-3 pb-4 pl-1 last:pb-0"
          >
            <div className="flex flex-col items-center">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-battery" />
              {i < items.length - 1 && <span className="w-px flex-1 bg-white/10" />}
            </div>
            <div className="-mt-0.5">
              <div className="font-mono text-xs tabular-nums text-text-muted">
                {new Date(item.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
              <div className="text-sm text-text-primary">{item.text}</div>
            </div>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
