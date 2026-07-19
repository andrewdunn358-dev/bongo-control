import { useEffect, useState } from "react";
import { X, CheckCircle2, AlertTriangle, AlertCircle } from "lucide-react";
import { api } from "../../services/api";

const SESSION_FLAG = "bongo-mission-brief-seen";
export const REOPEN_EVENT = "bongo:show-mission-brief";

const STATUS_META = {
  green: { icon: CheckCircle2, color: "#37d67a", label: "All Clear" },
  amber: { icon: AlertTriangle, color: "#ffb000", label: "Worth Watching" },
  red: { icon: AlertCircle, color: "#ff4b55", label: "Needs Attention" },
} as const;

interface MissionBrief {
  status: "green" | "amber" | "red";
  summary: string;
  recommendations: string[];
  predictions: { key: string; label: string; value: number | null; unit: string | null; confidence: string | null }[];
}

/**
 * Shown once per browser session (sessionStorage, not localStorage -
 * should reappear each new session/day, not be permanently dismissed
 * the way the app-unlock token is). Reuses the existing luminous Card
 * gradient language rather than inventing new modal chrome.
 */
export default function MissionBriefModal() {
  const [brief, setBrief] = useState<MissionBrief | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!sessionStorage.getItem(SESSION_FLAG)) {
      api.intelligence
        .missionBrief()
        .then((data) => {
          setBrief(data);
          setVisible(true);
        })
        .catch(() => {
          // No brief available yet (engine hasn't computed one, or the
          // backend's briefly unreachable) - fail soft, just don't show
          // the modal rather than blocking the dashboard on it.
        });
    }

    // Manual reopen (e.g. a "View SITREP" button) bypasses the
    // session-seen check entirely - dismissing shouldn't make it
    // unreachable for the rest of the session.
    const handleReopen = () => {
      api.intelligence
        .missionBrief()
        .then((data) => {
          setBrief(data);
          setVisible(true);
        })
        .catch(() => {});
    };
    window.addEventListener(REOPEN_EVENT, handleReopen);
    return () => window.removeEventListener(REOPEN_EVENT, handleReopen);
  }, []);

  const dismiss = () => {
    sessionStorage.setItem(SESSION_FLAG, "1");
    setVisible(false);
  };

  if (!visible || !brief) return null;

  const meta = STATUS_META[brief.status];
  const Icon = meta.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      <div
        className="relative w-full max-w-md overflow-hidden rounded-[1.75rem] border border-white/[0.08] bg-surface-card p-7 shadow-[0_24px_60px_rgba(0,0,0,0.6)]"
        style={{ boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 24px 60px rgba(0,0,0,0.6)` }}
      >
        <div
          className="pointer-events-none absolute -inset-1/2 opacity-60"
          style={{ background: `radial-gradient(circle at 30% 20%, ${meta.color}22, transparent 60%)` }}
        />

        <button
          onClick={dismiss}
          className="absolute right-5 top-5 z-10 text-text-muted transition-colors hover:text-text-primary"
          aria-label="Dismiss"
        >
          <X size={18} />
        </button>

        <div className="relative">
          <div className="flex items-center gap-2.5">
            <Icon size={20} style={{ color: meta.color }} />
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-text-muted">Daily SITREP · {meta.label}</span>
          </div>

          <p className="mt-4 text-2xl font-semibold leading-snug text-text-primary">{brief.summary}</p>

          {brief.recommendations.length > 0 && (
            <div className="mt-5 space-y-2">
              {brief.recommendations.map((rec, i) => (
                <div key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />
                  {rec}
                </div>
              ))}
            </div>
          )}

          {brief.predictions.length > 0 && (
            <div className="mt-5 grid grid-cols-2 gap-2">
              {brief.predictions.slice(0, 4).map((p) => (
                <div key={p.key} className="rounded-xl bg-surface-raised px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-text-muted">{p.label}</div>
                  <div className="font-mono text-sm text-text-primary">
                    {p.value === null ? "—" : p.unit === "bool" ? (p.value ? "Yes" : "No") : `${p.value}${p.unit ? ` ${p.unit}` : ""}`}
                  </div>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={dismiss}
            className="mt-6 w-full rounded-xl bg-white/[0.06] py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-white/[0.1]"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
