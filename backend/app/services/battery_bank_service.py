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

CORRECTING THE STATE OF CHARGE

`soc_pct` is computed inside the SmartShunt, against the battery capacity
configured in VictronConnect. That setting is a single fixed number and
this bank is not - so whenever the external battery is paralleled on, the
shunt is dividing by roughly half the capacity that is actually there and
its percentage is wrong before it ever reaches this app.

The app can compute the right one, and does. `consumed_ah` is a raw
integration of current in and out; it does not depend on the configured
capacity at all. So:

    corrected SoC = (connected Ah - consumed Ah) / connected Ah

which is the same arithmetic the shunt performs, with the capacity that
is genuinely connected instead of the one it was told about. Both numbers
in it are measured. This is not an estimate standing in for a measurement
- it is the measurement, divided correctly.

The correction is published as its own DERIVED telemetry source rather
than rewriting the shunt's payload, so the raw hardware reading is never
destroyed and the bus's existing precedence merge does the overriding. It
applies ONLY while the external battery is connected: with the leisure
battery alone the shunt's own configured capacity is right and its
percentage is correct, so the correction publishes None and hands the
field straight back. It should be, and is, a no-op in that case.

WHAT THIS STILL CANNOT FIX

The external battery's own 130W panel charges through a PWM controller
wired directly to the battery terminals, upstream of the shunt's sense
element - and because the Anderson connector parallels the two batteries,
that panel charges the whole bank unmeasured. `consumed_ah` therefore
counts energy leaving that it never saw arrive, so both the shunt's SoC
and the corrected one read LOWER than reality.

The correction above fixes the capacity error. It cannot fix this one,
because the missing amp-hours were never measured by anything. The drift
resets whenever the shunt sees a full charge, so it accumulates only
between syncs - worst in spring and autumn, when there is enough sun to
matter but not enough to reach a sync. Fixing it properly is one wire:
the PWM's negative moved from the battery post to the shunt's system
minus stud, at the cost of that panel doing nothing while the battery is
out of the van.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from app.services.battery_alarm_service import DEFAULT_DIVERGENCE_VOLTS
from app.services.configuration_service import ConfigurationService
from app.services.telemetry_service import TelemetryService
from app.telemetry.models import TelemetryDomain, TelemetryMessage, TelemetrySource

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
        self._task: asyncio.Task | None = None
        self._last_published_soc: float | None = None
        self._last_published_at: float = 0.0

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

    # ------------------------------------------------- corrected SoC

    def corrected_soc(self, payload: dict[str, Any]) -> dict[str, Any]:
        """State of charge recomputed against the capacity that is
        actually connected. See the module docstring.

        Returns `soc_pct: None` whenever the correction does not apply,
        which is the signal to fall back to the shunt's own figure - the
        bus merge skips None values, so publishing that hands the field
        back with no special-casing anywhere downstream.
        """
        bank = self.capacity(payload)
        consumed = _as_optional_float(payload.get("consumed_ah"))

        if not bank["external_connected"]:
            # Leisure battery alone: the shunt's configured capacity is
            # the right one and its percentage is already correct.
            # Correcting here would be inventing a difference.
            return {"soc_pct": None, "reason": "Shunt figure used — external battery not connected", "bank": bank}

        if consumed is None:
            # A shunt that has never seen a full charge reports neither
            # a percentage nor consumed amp-hours. Nothing to divide.
            return {"soc_pct": None, "reason": "No consumed-Ah reading yet", "bank": bank}

        capacity_ah = bank["amp_hours"]
        if capacity_ah <= 0:
            return {"soc_pct": None, "reason": "No bank capacity configured", "bank": bank}

        # Victron reports consumed amp-hours as a negative quantity
        # (-40Ah meaning 40Ah taken out). Taking the magnitude rather
        # than trusting a sign convention that differs between firmware
        # and library versions - it can only ever mean "this much has
        # been removed", so the sign carries no information the name
        # doesn't already.
        drawn = abs(consumed)
        remaining_fraction = (capacity_ah - drawn) / capacity_ah
        # Clamped because the inputs are independent measurements that
        # can disagree at the edges: more drawn than the configured
        # capacity, or a full-charge sync landing slightly late.
        soc = max(0.0, min(100.0, remaining_fraction * 100.0))

        return {
            "soc_pct": round(soc, 1),
            "reason": f"Recalculated against the connected {capacity_ah:.0f}Ah bank",
            "bank": bank,
        }

    async def start(self) -> None:
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _run(self) -> None:
        """Watches BATTERY telemetry and republishes the corrected state
        of charge under the DERIVED source.

        Republishing rather than correcting in the shunt plugin keeps the
        plugin layer unaware that services exist, which is the layering
        rule this codebase holds to everywhere else - and it means the
        correction reaches the WebSocket, the history table and every
        consumer at once, instead of each call site remembering to apply
        it.
        """
        queue = self._telemetry.subscribe()
        try:
            while True:
                message = await queue.get()
                if message.domain != TelemetryDomain.BATTERY:
                    continue
                # Our own republish comes back round the bus. Ignoring it
                # is what stops this being an infinite loop.
                if message.source == TelemetrySource.DERIVED:
                    continue
                try:
                    await self._publish_correction(message.payload)
                except Exception as e:  # noqa: BLE001 - a derived value must never take down telemetry
                    logger.warning("Could not publish corrected SoC: %s", e)
        except asyncio.CancelledError:
            raise
        finally:
            self._telemetry.unsubscribe(queue)

    async def _publish_correction(self, payload: dict[str, Any]) -> None:
        result = self.corrected_soc(payload)
        soc = result["soc_pct"]
        bank = result["bank"]

        # Throttled: the shunt broadcasts about once a second and a
        # state of charge does not move that fast. Publish on a real
        # change or every 30s, so the bus and the history table don't
        # carry a second copy of everything.
        now = time.time()
        changed = self._last_published_soc != soc
        if not changed and now - self._last_published_at < 30.0:
            return
        self._last_published_soc = soc
        self._last_published_at = now

        await self._telemetry.publish(
            TelemetryMessage(
                domain=TelemetryDomain.BATTERY,
                source=TelemetrySource.DERIVED,
                payload={
                    # None here relinquishes the field back to the shunt
                    # (the merge skips None), which is exactly what
                    # should happen when the correction doesn't apply.
                    "soc_pct": soc,
                    "soc_is_derived": soc is not None,
                    "soc_note": result["reason"],
                    "bank_amp_hours": bank["amp_hours"],
                    "external_connected": bank["external_connected"],
                },
            )
        )


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
