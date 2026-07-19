"""
BatterySignalProvider — reads the latest BATTERY telemetry and produces
a Signal. The voltage-only-fallback behavior (no shunt installed) is
carried over verbatim from PowerBudgetService's original
_compute_power_budget(), including its honest caveat wording — this is
a refactor of working, already-tuned logic, not a rewrite.
"""

from __future__ import annotations

from app.services.telemetry_service import TelemetryService
from app.telemetry.models import TelemetryDomain
from app.intelligence.signals import Signal, SignalSeverity

# Same thresholds already implied by PowerBudgetService's original
# "heater_all_night_possible" voltage check (> 12.8V).
VOLTAGE_OK_THRESHOLD = 12.8
VOLTAGE_WARNING_THRESHOLD = 12.2

SOC_CRITICAL_THRESHOLD = 20.0
SOC_WARNING_THRESHOLD = 40.0

NO_SHUNT_CAVEAT = "no battery shunt installed, voltage-only estimate"


class BatterySignalProvider:
    def __init__(self, telemetry_service: TelemetryService) -> None:
        self._telemetry = telemetry_service

    def evaluate(self) -> Signal | None:
        battery_msg = self._telemetry.latest(TelemetryDomain.BATTERY)
        if battery_msg is None:
            return Signal(source="battery", severity=SignalSeverity.UNKNOWN, message="No battery data yet", weight=2)

        soc_pct = battery_msg.payload.get("soc_pct")
        voltage = battery_msg.payload.get("voltage")

        if soc_pct is None:
            # No shunt - same voltage-only fallback PowerBudgetService
            # already used, with the same honest caveat carried over.
            if voltage is None:
                return Signal(source="battery", severity=SignalSeverity.UNKNOWN, message="No battery data yet", weight=2)
            if voltage > VOLTAGE_OK_THRESHOLD:
                return Signal(
                    source="battery",
                    severity=SignalSeverity.OK,
                    message=f"Battery voltage {voltage:.2f}V looks healthy ({NO_SHUNT_CAVEAT})",
                    weight=2,
                )
            if voltage > VOLTAGE_WARNING_THRESHOLD:
                return Signal(
                    source="battery",
                    severity=SignalSeverity.WARNING,
                    message=f"Battery voltage {voltage:.2f}V is getting low ({NO_SHUNT_CAVEAT})",
                    weight=2,
                )
            return Signal(
                source="battery",
                severity=SignalSeverity.CRITICAL,
                message=f"Battery voltage {voltage:.2f}V is critically low ({NO_SHUNT_CAVEAT})",
                weight=3,
            )

        if soc_pct < SOC_CRITICAL_THRESHOLD:
            return Signal(source="battery", severity=SignalSeverity.CRITICAL, message=f"Battery at {soc_pct:.0f}% - critically low", weight=3)
        if soc_pct < SOC_WARNING_THRESHOLD:
            return Signal(source="battery", severity=SignalSeverity.WARNING, message=f"Battery at {soc_pct:.0f}% - getting low", weight=2)

        state = "charging" if battery_msg.payload.get("charging") else "discharging steadily"
        return Signal(source="battery", severity=SignalSeverity.OK, message=f"Battery at {soc_pct:.0f}%, {state}", weight=1)
