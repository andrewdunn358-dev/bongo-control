"""
SolarOutlookSignalProvider — reads the latest WEATHER telemetry and
produces a Signal comparing tomorrow's forecast solar radiation against
today's. Thresholds and wording carried over verbatim from
PowerBudgetService's original _compute_tomorrow_outlook().
"""

from __future__ import annotations

from app.services.telemetry_service import TelemetryService
from app.telemetry.models import TelemetryDomain
from app.intelligence.signals import Signal, SignalSeverity

RATIO_SIMILAR_THRESHOLD = 0.85
RATIO_MODERATE_THRESHOLD = 0.5


class SolarOutlookSignalProvider:
    def __init__(self, telemetry_service: TelemetryService) -> None:
        self._telemetry = telemetry_service

    def evaluate(self) -> Signal | None:
        weather_msg = self._telemetry.latest(TelemetryDomain.WEATHER)
        if weather_msg is None:
            # Weather plugin not configured - no signal at all, not a
            # warning. Matches the original's informational (not
            # alarming) framing for "not set up yet".
            return None

        tomorrow = weather_msg.payload.get("tomorrow", {})
        ratio = weather_msg.payload.get("tomorrow_vs_today_radiation_ratio")
        description = tomorrow.get("weather_description", "unknown")

        if ratio is None:
            return Signal(
                source="solar_outlook",
                severity=SignalSeverity.UNKNOWN,
                message=f"Tomorrow looks {description} - not enough data yet to compare against today's production",
                weight=1,
            )
        if ratio >= RATIO_SIMILAR_THRESHOLD:
            return Signal(
                source="solar_outlook",
                severity=SignalSeverity.OK,
                message=f"Tomorrow looks {description} - similar solar production to today expected",
                weight=1,
            )
        if ratio >= RATIO_MODERATE_THRESHOLD:
            return Signal(
                source="solar_outlook",
                severity=SignalSeverity.WARNING,
                message=f"Tomorrow looks {description} - somewhat less solar than today, roughly {round(ratio * 100)}% as much",
                weight=1,
            )
        return Signal(
            source="solar_outlook",
            severity=SignalSeverity.WARNING,
            message=f"Tomorrow looks {description} - significantly less solar expected (~{round(ratio * 100)}% of today) - consider conserving power tonight",
            weight=2,
        )
