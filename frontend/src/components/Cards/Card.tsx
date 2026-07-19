import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

export type CardAccent = "solar" | "battery" | "alert" | "neutral";

const accentClass: Record<CardAccent, string> = {
  solar: "from-[#FFB000]/18 via-white/[0.03] to-transparent border-[#FFB000]/25",
  battery: "from-[#00C2A8]/18 via-white/[0.03] to-transparent border-[#00C2A8]/25",
  alert: "from-[#FF4B55]/20 via-white/[0.03] to-transparent border-[#FF4B55]/30",
  neutral: "from-white/[0.06] via-white/[0.025] to-transparent border-white/[0.08]",
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
      className={`relative overflow-hidden rounded-[2rem] border bg-[#151A21]/88 shadow-[0_20px_55px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-sm ${accentClass[accent]} ${className}`}
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${accentClass[accent]} opacity-80`} />
      <div className="absolute -right-16 -top-20 h-44 w-44 rounded-full bg-white/[0.035] blur-2xl" />
      <div className={`relative ${compact ? "p-5" : "p-5 sm:p-6 xl:p-7"}`}>
        {label && (
          <div className="mb-5 flex items-center gap-2 text-text-secondary">
            {icon && <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/[0.06] text-[#00C2A8] ring-1 ring-white/[0.06]">{icon}</span>}
            <span className="text-[0.68rem] font-bold uppercase tracking-[0.22em] text-white/48">{label}</span>
          </div>
        )}
        {children}
      </div>
    </motion.section>
  );
}
