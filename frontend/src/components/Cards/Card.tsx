import { motion } from "framer-motion";
import type { ReactNode } from "react";

export type CardAccent = "solar" | "battery" | "vehicle" | "neutral";

const accentBorder: Record<CardAccent, string> = {
  solar: "border-t-solar/60",
  battery: "border-t-battery/60",
  vehicle: "border-t-vehicle/60",
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
 * The base card every dashboard widget is built on. A 2px accent border
 * on top signals the card's domain (solar/battery/vehicle) without
 * relying on icon color alone — helps at a glance and for accessibility.
 */
export default function Card({ label, icon, accent = "neutral", className = "", children, index = 0 }: CardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.06, ease: "easeOut" }}
      className={`rounded-xl2 border-t-2 bg-surface-card shadow-card ${accentBorder[accent]} ${className}`}
    >
      <div className="p-5">
        {label && (
          <div className="mb-3 flex items-center gap-2 text-text-secondary">
            {icon}
            <span className="text-xs font-semibold uppercase tracking-wider">{label}</span>
          </div>
        )}
        {children}
      </div>
    </motion.div>
  );
}
