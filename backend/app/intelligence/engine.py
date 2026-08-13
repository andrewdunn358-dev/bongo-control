"""
IntelligenceEngine — aggregates Signals from registered providers into
an overall Mission Status (Green/Amber/Red), a plain-English summary,
a deduplicated Recommendations list, and Predictions.

Deliberately rule-based/deterministic (worst-signal-wins), not ML — per
the brief this was built from: "ready for future AI" means the seam
exists (see NarrativeGenerator note below), not that this version
guesses.
"""

from __future__ import annotations

import time
from enum import Enum

from pydantic import BaseModel

from app.intelligence.signals import Prediction, PredictionProvider, Signal, SignalProvider, SignalSeverity


class MissionStatus(str, Enum):
    GREEN = "green"
    AMBER = "amber"
    RED = "red"


class MissionBrief(BaseModel):
    status: MissionStatus
    summary: str
    recommendations: list[str]
    predictions: list[Prediction]
    signals: list[Signal]
    computed_at: float


class IntelligenceEngine:
    def __init__(self, signal_providers: list[SignalProvider], prediction_providers: list[PredictionProvider]) -> None:
        self._signal_providers = signal_providers
        self._prediction_providers = prediction_providers
        self._latest: MissionBrief | None = None

    def compute(self) -> MissionBrief:
        signals = [s for s in (p.evaluate() for p in self._signal_providers) if s is not None]
        predictions = [pred for p in self._prediction_providers for pred in p.predict()]

        status = self._aggregate_status(signals)
        brief = MissionBrief(
            status=status,
            summary=self._summarize(status),
            recommendations=self._recommendations(signals),
            predictions=predictions,
            signals=signals,
            computed_at=time.time(),
        )
        self._latest = brief
        return brief

    def latest(self) -> MissionBrief | None:
        """Serves the last computed value rather than forcing a
        synchronous recompute per request - matches the existing
        /api/plugins pattern, and matters here specifically because
        providers do real I/O (reading telemetry, querying history).
        """
        return self._latest

    @staticmethod
    def _aggregate_status(signals: list[Signal]) -> MissionStatus:
        # Worst-signal-wins - simple, deterministic, explainable. A
        # single CRITICAL anywhere pulls the whole mission status to
        # RED regardless of how many OK signals exist elsewhere -
        # deliberately conservative (a full battery doesn't offset a
        # failed plugin, say).
        if any(s.severity == SignalSeverity.CRITICAL for s in signals):
            return MissionStatus.RED
        if any(s.severity == SignalSeverity.WARNING for s in signals):
            return MissionStatus.AMBER
        return MissionStatus.GREEN

    @staticmethod
    def _recommendations(signals: list[Signal]) -> list[str]:
        # Only non-OK signals produce a recommendation - an OK signal
        # has nothing actionable to say, and UNKNOWN ("no data yet")
        # isn't something to act on either. Worst severity first, then
        # by weight, deduplicated by message text so the same
        # underlying issue reported by two providers doesn't show twice.
        actionable = [s for s in signals if s.severity in (SignalSeverity.WARNING, SignalSeverity.CRITICAL)]
        actionable.sort(key=lambda s: (s.severity != SignalSeverity.CRITICAL, -s.weight))
        seen: set[str] = set()
        out: list[str] = []
        for s in actionable:
            if s.message not in seen:
                seen.add(s.message)
                out.append(s.message)
        return out

    @staticmethod
    def _summarize(status: MissionStatus) -> str:
        if status == MissionStatus.GREEN:
            return "Everything looks good."
        if status == MissionStatus.AMBER:
            return "Worth keeping an eye on."
        return "Needs attention."

    # Reserved, not implemented: a future NarrativeGenerator could
    # replace _summarize()/_recommendations() with something LLM-backed,
    # taking the same signals/predictions as input. Per the brief this
    # design came from: any such integration is backend-only - never
    # call an LLM directly from the frontend, for the same reasons
    # (API keys, cost, offline-degradation) already settled elsewhere
    # in this project.
