import { useEffect, useState } from "react";
import { Sparkles, Landmark, Mountain, Utensils, MapPinned, ExternalLink } from "lucide-react";
import Card from "../Cards/Card";
import { api } from "../../services/api";

interface Recommendation {
  name: string;
  description: string;
  category: string;
}

const CATEGORY_ICON: Record<string, typeof Landmark> = {
  landmark: Landmark,
  walk: Mountain,
  food: Utensils,
  view: Mountain,
  other: MapPinned,
};

function mapsSearchUrl(name: string): string {
  // AI-suggested places don't come with precise coordinates (the model
  // isn't a mapping service) - a text search lets Maps itself geocode
  // the name and give real directions from there, rather than us
  // guessing at a lat/lon.
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`;
}

export default function AiRecommendationsCard() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[] | null>(null);
  const [placeName, setPlaceName] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Cheap status check only - never fetches actual recommendations
    // automatically, since each of those costs real money per call.
    api.ai
      .status()
      .then((s) => setConfigured(s.configured))
      .catch(() => setConfigured(false));
  }, []);

  const fetchRecommendations = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.ai.nearbyRecommendations();
      setRecommendations(result.recommendations);
      setPlaceName(result.place_name);
      setFromCache(result.from_cache);
      setCachedAt(result.cached_at);
    } catch {
      setError("Couldn't get recommendations right now - check the connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  if (configured === false) {
    return (
      <Card label="AI Recommendations" icon={<Sparkles size={16} />} accent="neutral">
        <p className="text-sm text-text-muted">
          Not set up. This optional feature needs an Anthropic API key - see{" "}
          <span className="font-mono">docs/ai_features.md</span> to enable it.
        </p>
      </Card>
    );
  }

  return (
    <Card label="AI Recommendations" icon={<Sparkles size={16} />} accent="solar">
      <div className="space-y-3">
        <p className="text-sm text-text-secondary">
          Get genuinely local suggestions for things worth seeing nearby.
          {placeName && <span className="text-text-muted"> Near {placeName}.</span>}
        </p>

        <button
          onClick={fetchRecommendations}
          disabled={loading || configured === null}
          className="rounded-lg bg-solar px-4 py-2 text-sm font-semibold text-black transition-all duration-150 hover:opacity-90 active:scale-95 disabled:opacity-50"
        >
          {loading ? "Thinking…" : "What's cool nearby?"}
        </button>

        {error && <p className="text-sm text-alert">{error}</p>}

        {recommendations && recommendations.length > 0 && (
          <>
            <p className="text-xs text-text-muted">
              AI-generated - worth double-checking details before relying on them.
              {fromCache && cachedAt && <span> Cached from {new Date(cachedAt * 1000).toLocaleDateString()}.</span>}
            </p>
            <div className="space-y-2.5">
              {recommendations.map((rec, i) => {
                const Icon = CATEGORY_ICON[rec.category] ?? MapPinned;
                return (
                  <a
                    key={i}
                    href={mapsSearchUrl(rec.name)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-start gap-3 rounded-xl bg-surface-raised p-3 transition-colors hover:bg-ink/[0.06]"
                  >
                    <Icon size={16} className="mt-0.5 shrink-0 text-solar" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-sm font-medium text-text-primary">
                        {rec.name}
                        <ExternalLink size={11} className="shrink-0 text-text-muted" />
                      </div>
                      <div className="mt-0.5 text-xs text-text-secondary">{rec.description}</div>
                    </div>
                  </a>
                );
              })}
            </div>
          </>
        )}

        {recommendations && recommendations.length === 0 && (
          <p className="text-sm text-text-muted">No specific suggestions came back - try again in a bit.</p>
        )}
      </div>
    </Card>
  );
}
