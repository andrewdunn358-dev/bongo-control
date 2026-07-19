import { useEffect, useState } from "react";
import { TrendingUp } from "lucide-react";
import Card from "../Cards/Card";
import { api } from "../../services/api";

interface Prediction {
  key: string;
  label: string;
  value: number | null;
  unit: string | null;
  confidence: string | null;
}

export default function PredictionsPanel({ index }: { index?: number }) {
  const [predictions, setPredictions] = useState<Prediction[] | null>(null);

  useEffect(() => {
    api.intelligence
      .missionBrief()
      .then((data) => setPredictions(data.predictions))
      .catch(() => setPredictions([]));
  }, []);

  return (
    <Card label="Predictions" icon={<TrendingUp size={16} />} accent="solar" index={index}>
      {predictions === null ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : predictions.length === 0 ? (
        <p className="text-sm text-text-muted">Not enough data yet to project anything.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {predictions.map((p) => (
            <div key={p.key} className="rounded-xl bg-surface-raised px-3.5 py-3">
              <div className="text-[10px] uppercase tracking-wide text-text-muted">{p.label}</div>
              <div className="mt-1 font-mono text-lg text-text-primary">
                {p.value === null ? "—" : p.unit === "bool" ? (p.value ? "Yes" : "No") : `${p.value}${p.unit ? ` ${p.unit}` : ""}`}
              </div>
              {p.confidence && <div className="mt-1 text-[10px] leading-tight text-text-muted">{p.confidence}</div>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
