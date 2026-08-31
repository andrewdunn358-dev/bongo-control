"""
BatterySignalProvider — reads the latest BATTERY telemetry and produces
a Signal. The voltage-only-fallback behavior (no shunt installed) is
carried over verbatim from the old PowerBudgetService (since deleted —
this layer replaced it), including its honest caveat wording: a
refactor of working, already-tuned logic rather than a rewrite.
"""

from __future__ import annotations

from app.services.telemetry_service import TelemetryService
from app.telemetry.models import TelemetryDomain
from app.intelligence.signals import Signal, SignalSeverity

# Same thresholds the old PowerBudgetService implied with its
# "heater_all_night_possible" voltage check (> 12.8V).
VOLTAGE_OK_THRESHOLD = 12.8
VOLTAGE_WARNING_THRESHOLD = 12.2

SOC_CRITICAL_THRESHOLD = 20.0
SOC_WARNING_THRESHOLD = 40.0

# Two different situations, and saying the wrong one is a lie the user
# can see: no shunt at all, versus a shunt fitted but not yet
# synchronised. A SmartShunt reports no state of charge until it has
# observed a full charge with the battery capacity configured, which
# can be days after fitting - and telling someone who just installed
# one that they haven't got one is worse than saying nothing.
NO_SHUNT_CAVEAT = "no battery shunt installed, voltage-only estimate"
SHUNT_UNSYNCED_CAVEAT = "shunt fitted but not yet synchronised - needs a full charge before it can report a percentage"


class BatterySignalProvider:
    def __init__(self, telemetry_service: TelemetryService) -> None:
        self._telemetry = telemetry_service

    def evaluate(self) -> Signal | None:
        battery_msg = self._telemetry.latest(TelemetryDomain.BATTERY)
        if battery_msg is None:
            return Signal(source="battery", severity=SignalSeverity.UNKNOWN, message="No battery data yet", weight=2)

        soc_pct = battery_msg.payload.get("soc_pct")
        voltage = battery_msg.payload.get("voltage")
        # current_a only ever comes from a shunt, so its presence is how
        # we know one exists even while soc_pct is still None.
        caveat = SHUNT_UNSYNCED_CAVEAT if battery_msg.payload.get("current_a") is not None else NO_SHUNT_CAVEAT

        if soc_pct is None:
            # No shunt - same voltage-only fallback the old PowerBudgetService
            # already used, with the same honest caveat carried over.
            if voltage is None:
                return Signal(source="battery", severity=SignalSeverity.UNKNOWN, message="No battery data yet", weight=2)
            if voltage > VOLTAGE_OK_THRESHOLD:
                return Signal(
                    source="battery",
                    severity=SignalSeverity.OK,
                    message=f"Battery voltage {voltage:.2f}V looks healthy ({caveat})",
                    weight=2,
                )
            if voltage > VOLTAGE_WARNING_THRESHOLD:
                return Signal(
                    source="battery",
                    severity=SignalSeverity.WARNING,
                    message=f"Battery voltage {voltage:.2f}V is getting low ({caveat})",
                    weight=2,
                )
            return Signal(
                source="battery",
                severity=SignalSeverity.CRITICAL,
                message=f"Battery voltage {voltage:.2f}V is critically low ({caveat})",
                weight=3,
            )

        if soc_pct < SOC_CRITICAL_THRESHOLD:
            return Signal(source="battery", severity=SignalSeverity.CRITICAL, message=f"Battery at {soc_pct:.0f}% - critically low", weight=3)
        if soc_pct < SOC_WARNING_THRESHOLD:
            return Signal(source="battery", severity=SignalSeverity.WARNING, message=f"Battery at {soc_pct:.0f}% - getting low", weight=2)

        state = "charging" if battery_msg.payload.get("charging") else "discharging steadily"
        return Signal(source="battery", severity=SignalSeverity.OK, message=f"Battery at {soc_pct:.0f}%, {state}", weight=1)
