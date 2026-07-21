import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

export type CardAccent = "solar" | "battery" | "alert" | "neutral";

const accentClass: Record<CardAccent, string> = {
  solar: "from-solar/18 via-ink/[0.03] to-transparent border-solar/25",
  battery: "from-battery/18 via-ink/[0.03] to-transparent border-battery/25",
  alert: "from-alert/20 via-ink/[0.03] to-transparent border-alert/30",
  neutral: "from-ink/[0.06] via-ink/[0.025] to-transparent border-ink/[0.08]",
};

interface CardProps {
  label?: string;
  icon?: ReactNode;
  accent?: CardAccent;
  className?: string;
  children: ReactNode;
  index?: number;
  compact?: boolean;
}

export default function Card({ label, icon, accent = "neutral", className = "", children, index = 0, compact = false }: CardProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.section
      initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={reduceMotion ? undefined : { y: -2 }}
      transition={{ duration: 0.32, delay: index * 0.035, ease: [0.16, 1, 0.3, 1] }}
      /* Glass: the surface is deliberately translucent (72%) rather than
         near-opaque, so the aurora backdrop actually shows through and
         shifts as the blobs drift. At the previous 88% it read as a
         flat panel that merely happened to sit on a gradient.
         backdrop-blur-xl is what stops that translucency turning into
         visual noise. The inset white line along the top edge is the
         single detail that most makes a surface read as glass rather
         than tinted plastic. */
      className={`relative overflow-hidden rounded-[2rem] border bg-surface-card/72 shadow-[0_24px_60px_-12px_rgb(var(--color-base-deep)/0.7),inset_0_1px_0_rgb(var(--color-ink)/0.10)] backdrop-blur-xl ${accentClass[accent]} ${className}`}
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${accentClass[accent]} opacity-80`} />
      <div className="absolute -right-16 -top-20 h-44 w-44 rounded-full bg-ink/[0.035] blur-2xl" />
      <div className={`relative ${compact ? "p-5" : "p-5 sm:p-6 xl:p-7"}`}>
        {label && (
          <div className="mb-5 flex items-center gap-2 text-text-secondary">
            {icon && <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-ink/[0.06] text-battery ring-1 ring-ink/[0.08]">{icon}</span>}
            <span className="text-[0.68rem] font-bold uppercase tracking-[0.22em] text-ink/48">{label}</span>
          </div>
        )}
        {children}
      </div>
    </motion.section>
  );
}
