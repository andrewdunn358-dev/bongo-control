"""
BatteryBankService — how much battery is actually connected right now.

Every "how long will this last" figure in the app used to divide by one
hardcoded constant, `NOMINAL_BANK_WH = 100 * 12.8`, in three separate
files. That constant was wrong twice over: the permanent leisure battery
is 120Ah, not 100Ah, and there is a second 130Ah AGM that spends part of
its life paralleled onto the bank through an Anderson connector. With
the external battery in, the van has more than twice the energy the
runtime estimate assumed, and said so.

This service is the single answer to "what capacity are we running on",
so the runtime estimate, the days-to-floor projection and anything added
later all agree with each other and change in one place.

DETECTING THE EXTERNAL BATTERY

The SmartShunt's AUX input reads the external battery's voltage (Victron
call it the starter battery input; here it is the external leisure one).
That gives a voltage and nothing else - the aux input cannot measure
current, so there is no state of charge for that battery and none is
invented.

Presence of an aux reading is NOT the test, and this is the part worth
being careful about. The sense wire can keep reporting a perfectly
healthy 12.8V off a battery whose Anderson connector has backed out or
whose breaker has tripped from road vibration - both known faults on this
van, and exactly what battery_alarm_service's divergence check exists to
catch. A battery that is present but not connected contributes nothing.

So the test is voltage AGREEMENT: two batteries genuinely paralleled are
electrically the same node and must sit at the same voltage. A gap wider
than the divergence threshold means they are not connected to each other,
whatever the aux input says. The threshold is read from the same `alarms`
config the divergence alarm uses, so the two can never drift apart and
disagree about whether the battery is connected.

WHERE THIS IS HONEST ABOUT ITS LIMITS

Agreement is a strong test under load or charge - a disconnected battery
diverges within seconds once current flows. At rest it is weaker: two
disconnected batteries can both happen to sit at 12.7V. That ambiguity is
reported (`confident`) rather than hidden, because the direction of the
error matters: over-stating capacity tells someone they have two days of
headroom when they have none. Under-stating it just means a pleasant
surprise.

WHAT THIS SERVICE DOES NOT FIX

`soc_pct` is computed inside the SmartShunt against the capacity
configured in VictronConnect, and arrives here already calculated. This
service does not change it. If the shunt is configured for one battery
while two are connected, its percentage is wrong at the source and no
arithmetic here corrects that - it can only be fixed in VictronConnect.
What this service does is stop the app compounding the problem by
converting that percentage into watt-hours with the wrong capacity.

Separately: the external battery's own 130W panel charges through a PWM
controller wired directly to the battery terminals, which is upstream of
the shunt's sense element. That harvest is real but unmeasured, so
`consumed_ah` counts energy leaving that it never saw arrive. Noted here
because it is the same battery, and because anything reading this service
to build an energy figure should know that the external battery's input
is invisible.
"""

from __future__ import annotations

import logging
from typing import Any

from app.services.battery_alarm_service import DEFAULT_DIVERGENCE_VOLTS
from app.services.configuration_service import ConfigurationService
from app.services.telemetry_service import TelemetryService
from app.telemetry.models import TelemetryDomain

logger = logging.getLogger("vanos.battery_bank_service")

# Measured, not nominal-round-number guesses: the permanent leisure
# battery and the removable external one that carries the inverter.
DEFAULT_LEISURE_AH = 120.0
DEFAULT_EXTERNAL_AH = 130.0
# Watt-hours per amp-hour. Nominal AGM resting voltage rather than the
# live reading: capacity is a property of the batteries, and multiplying
# by an instantaneous voltage would shrink the bank every time a load
# came on - the runtime estimate would drop the moment you switched
# something on, for two separate reasons at once.
NOMINAL_VOLTS = 12.8


class BatteryBankService:
    def __init__(
        self,
        telemetry_service: TelemetryService,
        configuration_service: ConfigurationService,
    ) -> None:
        self._telemetry = telemetry_service
        self._config = configuration_service

    def _settings(self) -> tuple[float, float]:
        cfg = self._config.get("battery_bank", {}) or {}
        return (
            _as_float(cfg.get("leisure_ah"), DEFAULT_LEISURE_AH),
            _as_float(cfg.get("external_ah"), DEFAULT_EXTERNAL_AH),
        )

    def _divergence_threshold(self) -> float:
        """Shared with the divergence alarm deliberately - one number
        decides both "are these two connected" and "warn me that they
        aren't", so the app can't simultaneously alarm about a
        disconnected battery and count its capacity."""
        cfg = self._config.get("alarms", {}) or {}
        return _as_float(cfg.get("divergence_volts"), DEFAULT_DIVERGENCE_VOLTS)

    def capacity(self, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        """Current usable bank, as amp-hours and watt-hours, plus why.

        `payload` lets a caller pass a BATTERY payload it already has
        (and lets the tests drive this without a bus); omitted, it reads
        the latest from telemetry.
        """
        leisure_ah, external_ah = self._settings()

        if payload is None:
            message = self._telemetry.latest(TelemetryDomain.BATTERY)
            payload = message.payload if message else {}

        internal_v = _as_optional_float(payload.get("voltage"))
        external_v = _as_optional_float(payload.get("external_voltage"))
        current_a = _as_optional_float(payload.get("current_a"))

        connected = False
        confident = True
        if external_v is None or internal_v is None:
            # No aux reading: the external battery isn't fitted, or the
            # shunt isn't reporting. Either way there is nothing to add.
            reason = "External battery not detected"
        else:
            gap = abs(internal_v - external_v)
            if gap > self._divergence_threshold():
                reason = (
                    f"External battery present but not connected — {gap:.2f}V apart"
                )
            else:
                connected = True
                # Under any meaningful current the agreement is proof:
                # a disconnected battery diverges within seconds once
                # current flows. At rest, two unconnected batteries can
                # coincidentally match, so the answer is the same but
                # the confidence isn't.
                confident = current_a is not None and abs(current_a) >= 1.0
                reason = (
                    "External battery connected"
                    if confident
                    else "External battery appears connected — bank at rest, can't confirm under load"
                )

        total_ah = leisure_ah + external_ah if connected else leisure_ah
        return {
            "amp_hours": round(total_ah, 1),
            "watt_hours": round(total_ah * NOMINAL_VOLTS, 1),
            "leisure_ah": leisure_ah,
            "external_ah": external_ah,
            "external_connected": connected,
            "confident": confident,
            "reason": reason,
        }

    def watt_hours(self, payload: dict[str, Any] | None = None) -> float:
        """Just the number, for the arithmetic-only call sites."""
        return float(self.capacity(payload)["watt_hours"])


def _as_float(value: Any, fallback: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _as_optional_float(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
