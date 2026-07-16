import type { ReactNode } from "react";

// Deliberately plain — a real Card component (shadows, motion, Tesla-style
// treatment) lands once the design system from the UI/UX sprint is ready.
export default function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-surface-card p-4 shadow">
      <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-white/50">{title}</h2>
      <div className="text-lg">{children}</div>
    </div>
  );
}
