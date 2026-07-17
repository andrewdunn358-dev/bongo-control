import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

export type CardAccent = "solar" | "battery" | "alert" | "neutral";

// Softer than before (was /60) - per design feedback the accent border
// was competing with content rather than quietly signaling domain.
const accentBorder: Record<CardAccent, string> = {
  solar: "border-t-solar/35",
  battery: "border-t-battery/35",
  alert: "border-t-alert/50", // alert stays a touch stronger - it should be noticed
  neutral: "border-t-transparent",
};

interface CardProps {
  /** Eyebrow label — short, e.g. "POWER BUDGET". Keep to 1-3 words. */
  label?: string;
  /** Optional icon rendered next to the label. */
  icon?: ReactNode;
  accent?: CardAccent;
  className?: string;
  children: ReactNode;
  /** Stagger index for entrance animation when several cards mount together. */
  index?: number;
}

/**
 * The base card every dashboard widget is built on. A top accent border
 * signals the card's domain (solar/battery) without relying on icon
 * color alone — helps at a glance and for accessibility.
 */
export default function Card({ label, icon, accent = "neutral", className = "", children, index = 0 }: CardProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={reduceMotion ? undefined : { y: -3, scale: 1.006 }}
      transition={{ duration: 0.35, delay: index * 0.05, ease: [0.16, 1, 0.3, 1] }}
      className={`rounded-xl2 border-t-2 bg-surface-card shadow-card transition-shadow duration-300 hover:shadow-lg ${accentBorder[accent]} ${className}`}
      style={{ willChange: "transform" }}
    >
      <div className="p-7">
        {label && (
          <div className="mb-4 flex items-center gap-2 text-text-secondary">
            {icon}
            <span className="text-[11px] font-semibold uppercase tracking-widest">{label}</span>
          </div>
        )}
        {children}
      </div>
    </motion.div>
  );
}
