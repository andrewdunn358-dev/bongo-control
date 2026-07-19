import { useEffect, useState } from "react";
import { ListChecks, RefreshCw, CheckCircle2 } from "lucide-react";
import Card from "../Cards/Card";
import { api } from "../../services/api";
import { REOPEN_EVENT } from "./MissionBriefModal";

export default function RecommendationsPanel({ index }: { index?: number }) {
  const [recommendations, setRecommendations] = useState<string[] | null>(null);

  useEffect(() => {
    api.intelligence
      .missionBrief()
      .then((data) => setRecommendations(data.recommendations))
      .catch(() => setRecommendations([]));
  }, []);

  return (
    <Card label="Recommendations" icon={<ListChecks size={16} />} accent="battery" index={index}>
      <div className="mb-3 flex items-center justify-end">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent(REOPEN_EVENT))}
          className="flex items-center gap-1 text-xs text-text-muted transition-colors hover:text-text-primary"
        >
          <RefreshCw size={12} /> View SITREP
        </button>
      </div>

      {recommendations === null ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : recommendations.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <CheckCircle2 size={16} className="text-battery" />
          Nothing needs your attention right now.
        </div>
      ) : (
        <div className="space-y-2.5">
          {recommendations.map((rec, i) => (
            <div key={i} className="flex items-start gap-2.5 text-sm text-text-primary">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-solar" />
              {rec}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
