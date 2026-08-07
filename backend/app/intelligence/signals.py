"""
Signal / Prediction contracts for the Intelligence Engine.

Deliberately pull-based, matching the whole rest of this codebase's
philosophy (stated in telemetry/models.py): consumers pull the latest
value for a domain, nothing pushes to a specific named consumer.
PowerBudgetService already worked this way — it called
telemetry_service.latest(TelemetryDomain.BATTERY) itself, rather than
BatteryService knowing PowerBudgetService existed.

Why this matters for extensibility: a future Water Tank plugin (or
Heating, Door Sensors, etc.) needs to contribute to the mission brief
without IntelligenceEngine's core code ever changing. With this
contract, adding one means: (1) add a TelemetryDomain for it, (2) the
plugin publishes telemetry same as any other plugin — zero coupling to
intelligence, (3) write a small SignalProvider reading that domain, (4)
register it in one list at startup. The engine never imports or knows
about Water specifically.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Optional, Protocol

from pydantic import BaseModel


class SignalSeverity(str, Enum):
    OK = "ok"
    WARNING = "warning"
    CRITICAL = "critical"
    UNKNOWN = "unknown"  # no data yet - distinct from OK, shouldn't read as "fine"


class Signal(BaseModel):
    source: str  # "battery", "solar_outlook", "water_tank", ...
    severity: SignalSeverity
    message: str  # human-readable, e.g. "Battery at 42%, discharging steadily"
    weight: int = 1  # relative importance when multiple signals disagree
    # Optional structured extras for the frontend (e.g. the solar verdict
    # carries {"verdict": "good", "today_mj": ..., "clearsky_mj": ...} so
    # a card can render a coloured pill and figures without re-parsing the
    # message). Defaults to None; existing providers set nothing.
    detail: Optional[dict[str, Any]] = None


class SignalProvider(Protocol):
    """One provider per domain/concern. Returns None if it has nothing
    to say right now (e.g. that domain has no data yet, or isn't
    configured) - a provider with nothing to report should not force a
    signal into existence.
    """

    def evaluate(self) -> Signal | None: ...


class Prediction(BaseModel):
    key: str  # "estimated_runtime_hours", "solar_today_mj", ...
    label: str  # "Estimated runtime"
    value: float | int | None
    unit: str | None = None  # "hours", "%", "MJ/m²"
    # Same honesty pattern as PowerBudgetService's existing "note"
    # field - e.g. "No battery shunt installed - voltage-only estimate,
    # not precise". Shown alongside the number, not silently omitted.
    confidence: str | None = None


class PredictionProvider(Protocol):
    def predict(self) -> list[Prediction]: ...
