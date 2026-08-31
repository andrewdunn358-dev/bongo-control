"""
BatteryAlarmService — the two battery conditions on this van that are
worth waking someone up for, rather than worth drawing on a graph.

    1. State of charge below the AGM floor.
    2. The two batteries in the parallel bank drifting apart.

WHY THIS IS SEPARATE FROM BatteryService
BatteryService already raises low/critical notifications at 20% and
10%. Those are generic "the battery is nearly empty" alerts and they
stay exactly as they are. This service exists for a different job: a
lead-acid/AGM bank is damaged by being taken below roughly 50%, so on
this van 50% is not "getting low", it is the number that matters, and
by 20% the damage the alarm was meant to prevent has already been
done. The two run alongside each other; the thresholds don't collide
because 50% fires first and means something different.

The second alarm has no equivalent anywhere else. This bank is two AGMs
in parallel through an Anderson connector - a permanent leisure battery
and a removable external one - and the shunt measures only the first
directly. The second is on the shunt's AUX input, which reports voltage
and nothing else (no current, so no state of charge for it, and none is
invented). Two healthy batteries in parallel sit at the same voltage.
A sustained gap between them means the link between them is not doing
its job: the Anderson connector backing out, the external battery's
circuit breaker tripped from road vibration (a known fault on this
van), or one battery genuinely failing. All three are quiet failures -
nothing stops working, the van just slowly starts running on one
battery - which is exactly the kind of thing worth a push notification
and exactly the kind of thing a person never notices in time.

DELIBERATE DESIGN CHOICES

*Off by default.* A brand-new alarm that has never run against this
van's real data is not something to switch on for someone remotely.
It ships disabled with the thresholds visible, so the first thing that
happens is a person deciding to turn it on.

*Divergence must be SUSTAINED.* An instantaneous voltage difference
between two paralleled batteries is completely normal - switch on the
inverter and the battery carrying it sags for as long as the load
lasts. Alarming on a single reading would mean an alert every time the
kettle went on. The gap has to persist for DIVERGENCE_SUSTAIN_SECONDS
of continuous readings before it counts, which is the difference
between "a load is running" and "these batteries are not connected to
each other properly".

*Hysteresis on both alarms.* A value sitting exactly on a threshold
flickers across it, and an alarm that clears and re-raises every
minute trains you to ignore it. Each alarm clears at a deliberately
easier level than it raises (RECOVER_MARGIN_PCT, RECOVER_MARGIN_V),
so recovery has to be real.

*A re-notify ceiling, not a repeat.* While a condition persists it is
re-sent at most once every renotify_hours (default 6). Silence after
the first alert would let a genuine problem be forgotten; a reminder
every reading would be noise.

*Delivery is layered, and the app layer always runs.* Every alarm goes
to the existing in-app notification service. If an ntfy topic is
configured it ALSO goes to a phone. ntfy is used rather than a
per-vendor push service because it needs no account, no key and no
app-store presence - a topic name is the whole configuration. That
also means the topic name IS the credential: anyone who knows it can
read the alerts, which is why it is treated as a secret and never read
back by the API.

A failed ntfy POST is logged and swallowed. The van having no signal
is the normal case for this vehicle, not an error, and it must never
stop the in-app notification from being raised or take down the
subscriber loop.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Callable

import httpx

from app.services.configuration_service import ConfigurationService
from app.services.notification_service import NotificationLevel, NotificationService
from app.services.telemetry_service import TelemetryService
from app.telemetry.models import TelemetryDomain

logger = logging.getLogger("vanos.battery_alarm_service")

# Defaults, all overridable from the "alarms" config section.
DEFAULT_SOC_FLOOR_PCT = 50.0
DEFAULT_DIVERGENCE_VOLTS = 0.4
DEFAULT_RENOTIFY_HOURS = 6.0

# How far back above a threshold things have to come before the alarm
# is considered cleared. See the hysteresis note in the module
# docstring.
RECOVER_MARGIN_PCT = 5.0
RECOVER_MARGIN_V = 0.1

# A voltage gap has to hold for this long, continuously, before it
# counts as divergence rather than a load.
DIVERGENCE_SUSTAIN_SECONDS = 600.0

NTFY_TIMEOUT_SECONDS = 10.0
DEFAULT_NTFY_SERVER = "https://ntfy.sh"


class BatteryAlarmService:
    def __init__(
        self,
        telemetry_service: TelemetryService,
        notification_service: NotificationService,
        configuration_service: ConfigurationService,
        now: Callable[[], float] = time.time,
    ) -> None:
        self._telemetry = telemetry_service
        self._notifications = notification_service
        self._config = configuration_service
        # Injected so the tests can drive six hours of re-notify
        # behaviour without waiting six hours. Production passes
        # time.time and never thinks about it again.
        self._now = now
        self._task: asyncio.Task | None = None
        # Per-alarm: when it was last sent, or None if not currently
        # raised. This doubles as the "is it active" flag, which keeps
        # the two from ever disagreeing.
        self._last_sent_at: dict[str, float] = {}
        # First moment of the current unbroken run of divergent
        # readings. Reset to None the instant a reading is back inside
        # the threshold.
        self._divergence_since: float | None = None

    # ----------------------------------------------------------- config

    def _settings(self) -> dict[str, Any]:
        """Read fresh on every reading rather than cached at startup, so
        enabling the alarms or changing a threshold in Settings takes
        effect immediately. This is a handful of dict lookups against
        an already-in-memory config, not a file read.
        """
        cfg = self._config.get("alarms", {}) or {}
        return {
            "enabled": bool(cfg.get("battery_enabled", False)),
            "soc_floor_pct": _as_float(cfg.get("soc_floor_pct"), DEFAULT_SOC_FLOOR_PCT),
            "divergence_volts": _as_float(cfg.get("divergence_volts"), DEFAULT_DIVERGENCE_VOLTS),
            "renotify_hours": _as_float(cfg.get("renotify_hours"), DEFAULT_RENOTIFY_HOURS),
            "ntfy_topic": str(cfg.get("ntfy_topic") or "").strip(),
            "ntfy_server": str(cfg.get("ntfy_server") or "").strip() or DEFAULT_NTFY_SERVER,
        }

    # ------------------------------------------------------- lifecycle

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
        queue = self._telemetry.subscribe()
        try:
            while True:
                message = await queue.get()
                if message.domain != TelemetryDomain.BATTERY:
                    continue
                try:
                    await self.evaluate(message.payload)
                except Exception as e:  # noqa: BLE001 - one bad reading must not kill the loop
                    logger.warning("Battery alarm evaluation failed: %s", e)
        except asyncio.CancelledError:
            raise
        finally:
            self._telemetry.unsubscribe(queue)

    # ---------------------------------------------------------- logic

    async def evaluate(self, payload: dict[str, Any]) -> None:
        """One reading in, zero or more alarms out. Public and
        side-effect-only-through-injected-collaborators so the tests can
        call it directly with a synthetic payload rather than standing
        up a bus.
        """
        settings = self._settings()
        if not settings["enabled"]:
            # Clear state while disabled, so re-enabling doesn't
            # immediately fire on a stale raised flag from before.
            self._last_sent_at.clear()
            self._divergence_since = None
            return

        await self._check_soc_floor(payload, settings)
        await self._check_divergence(payload, settings)

    async def _check_soc_floor(self, payload: dict[str, Any], settings: dict[str, Any]) -> None:
        soc = _as_optional_float(payload.get("soc_pct"))
        if soc is None:
            # No shunt, or a shunt that has not synchronised yet. Not an
            # alarm and not a recovery - simply nothing to say, the same
            # way this app shows a dash rather than inferring a
            # percentage from voltage.
            return

        floor = settings["soc_floor_pct"]
        if soc <= floor:
            await self._raise(
                "soc_floor",
                settings,
                NotificationLevel.WARNING,
                "Battery below floor",
                f"State of charge {soc:.0f}%, below the {floor:.0f}% floor. "
                f"Charging now avoids shortening the batteries' life.",
            )
        elif soc >= floor + RECOVER_MARGIN_PCT:
            self._clear("soc_floor")

    async def _check_divergence(self, payload: dict[str, Any], settings: dict[str, Any]) -> None:
        internal = _as_optional_float(payload.get("voltage"))
        external = _as_optional_float(payload.get("external_voltage"))
        if internal is None or external is None:
            # The external battery is removable. Unplugged means the aux
            # input reports nothing, and "not fitted right now" is not a
            # fault - so this resets the sustain timer rather than
            # alarming or clearing.
            self._divergence_since = None
            return

        gap = abs(internal - external)
        threshold = settings["divergence_volts"]
        now = self._now()

        if gap <= threshold - RECOVER_MARGIN_V:
            self._divergence_since = None
            self._clear("divergence")
            return

        if gap <= threshold:
            # In the hysteresis band: not divergent enough to start the
            # clock, not recovered enough to clear a raised alarm.
            # Deliberately leaves both alone.
            return

        if self._divergence_since is None:
            self._divergence_since = now
            return

        if now - self._divergence_since < DIVERGENCE_SUSTAIN_SECONDS:
            return  # still could just be a load

        held_for = now - self._divergence_since
        await self._raise(
            "divergence",
            settings,
            NotificationLevel.WARNING,
            "Batteries diverging",
            f"Leisure {internal:.2f}V vs external {external:.2f}V — a {gap:.2f}V gap held for "
            f"{held_for / 60:.0f} minutes. Check the Anderson connector and the external "
            f"battery's breaker.",
        )

    # ------------------------------------------------------- delivery

    async def _raise(
        self,
        key: str,
        settings: dict[str, Any],
        level: NotificationLevel,
        title: str,
        message: str,
    ) -> None:
        now = self._now()
        last = self._last_sent_at.get(key)
        if last is not None and now - last < settings["renotify_hours"] * 3600:
            return  # already alerted recently; the condition persisting is not new information
        self._last_sent_at[key] = now

        await self._notifications.notify(level, title, message)
        await self._push(settings, title, message)
        logger.warning("Battery alarm raised (%s): %s", key, message)

    def _clear(self, key: str) -> None:
        if self._last_sent_at.pop(key, None) is not None:
            logger.info("Battery alarm cleared (%s)", key)

    async def _push(self, settings: dict[str, Any], title: str, message: str) -> None:
        """Best-effort push to ntfy. Never raises: no signal is this
        van's normal state, and the in-app notification has already
        been delivered by the time this runs.
        """
        topic = settings["ntfy_topic"]
        if not topic:
            return
        url = f"{settings['ntfy_server'].rstrip('/')}/{topic}"
        try:
            async with httpx.AsyncClient(timeout=NTFY_TIMEOUT_SECONDS) as client:
                response = await client.post(
                    url,
                    content=message.encode("utf-8"),
                    headers={
                        # ntfy takes these as headers rather than a JSON
                        # body; latin-1 is what the HTTP header encoding
                        # actually permits, so a non-ASCII character in
                        # a title would otherwise raise here rather than
                        # over the wire.
                        "Title": title.encode("utf-8").decode("latin-1", "replace"),
                        "Priority": "high",
                        "Tags": "battery",
                    },
                )
                response.raise_for_status()
        except Exception as e:  # noqa: BLE001 - a van with no signal is normal, not an error
            logger.warning("Could not push alarm to ntfy (%s): %s", url, e)


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
