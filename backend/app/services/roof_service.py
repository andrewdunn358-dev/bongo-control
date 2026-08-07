"""
RoofService — hold-to-run control for the AFT elevating roof.

This is the most safety-critical thing in the project, and it is
deliberately NOT modelled as an on/off switch.

WHY HOLD-TO-RUN RATHER THAN A TOGGLE
The physical roof switch is momentary: you hold it and watch the roof
move, and it stops the instant you let go. That property is the whole
safety design of the mechanism — a person is actively choosing to
continue, every moment it moves. A toggle in an app would throw that
away: if the phone lost signal after "up", the motor would keep
driving with nothing left to stop it.

So the app must keep SAYING it wants the roof to move. The client
sends a "hold" request roughly every 500ms; each one resets a watchdog.
If the watchdog expires the relay drops. Every failure mode therefore
stops the motor rather than continuing it:

  finger lifted        -> requests stop -> relay drops
  wifi drops           -> requests stop -> relay drops
  phone locks/sleeps   -> requests stop -> relay drops
  browser closed       -> requests stop -> relay drops
  backend crashes      -> GPIO released -> relay drops

WHAT THIS DOES NOT DO
It does not bypass anything. The relays sit in parallel with the
physical switch, upstream of the AFT control unit, so the vehicle's own
interlocks all still apply: engine running, handbrake on, limit
switches, the beeper. Pressing a button here is exactly equivalent to
someone holding the physical switch — no more authority than that.

THE SWITCH-ISOLATION RELAYS
This particular switch is a dynamic-brake type: at rest it actively
SHORTS its two signal wires together (that's how it brakes the roof the
instant you let go), rather than leaving them open like a plain on/off
switch. That's a real conflict with the direction relays sitting in
parallel on those same two wires - the moment one relay drives its wire
to +12V, the switch's own resting bridge gives that current a
low-resistance shortcut straight to the other relay's ground, instead
of through the ECU/motor.

`isolate_channels`, if configured, are relays wired in series with the
switch's two signal wires (one relay per wire - see docs/roof notes for
why both, not just one: isolating a single wire still leaves the other
half of the switch's bridge fully connected the whole time). Each is
energised for the exact duration of a hold (same moment the direction
relays fire, same moment they drop) purely to break its one wire,
disconnecting the switch's bridge from the circuit while the app is
driving. The instant the hold ends, they de-energise and the switch is
reconnected, working exactly as it always did. Optional - if none are
configured, the app still works, it's on you to keep the switch
unplugged or otherwise out of circuit while driving from here.

The app also cannot tell whether the roof actually moved. There is no
position sensor, and no feedback path from the control unit. It knows
only what it commanded. Everything user-facing says so.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Literal

from app.services.relay_service import RelayService, RelayUnavailableError, record_relay_event

logger = logging.getLogger("vanos.roof_service")

Direction = Literal["up", "down"]

# How long the relay stays energised after the last hold request. The
# client sends every ~500ms, so this allows one dropped request before
# stopping - short enough that releasing the button feels immediate,
# long enough not to stutter on a flaky connection.
WATCHDOG_SECONDS = 1.5

# Absolute ceiling on a single continuous movement, regardless of how
# many hold requests arrive. A full roof travel is well under this. It
# exists so a stuck button, a wedged screen, or a scripted client
# cannot drive the motor indefinitely against a jammed mechanism.
MAX_RUN_SECONDS = 30.0

# Enforced gap between opposite directions. Contactors need a moment to
# physically open before the other closes; going straight from up to
# down risks both being briefly closed at once, which the control unit
# would see as a contradictory request.
DIRECTION_CHANGE_PAUSE_SECONDS = 0.5


class RoofUnavailableError(RuntimeError):
    pass


class RoofService:
    def __init__(self, relay_service: RelayService) -> None:
        self._relays = relay_service
        self._up_channel: int | None = None
        self._down_channel: int | None = None
        self._isolate_channels: list[int] = []
        self._enabled = False

        self._active: Direction | None = None
        self._last_hold_at: float = 0.0
        self._started_at: float = 0.0
        self._stopped_reason: str | None = None
        self._last_direction_end: float = 0.0
        self._watchdog_task: asyncio.Task | None = None
        self._lock = asyncio.Lock()

    def configure(self, config: dict[str, Any]) -> None:
        """Roof control is OFF unless explicitly enabled and both
        channels are assigned. Defaulting to on would mean a fresh
        install could drive a roof motor before anyone had wired or
        checked anything. isolate_channels is optional - see the module
        docstring for what it's for.
        """
        self._enabled = bool(config.get("enabled", False))
        self._up_channel = config.get("up_channel")
        self._down_channel = config.get("down_channel")

        channels = config.get("isolate_channels")
        if channels is None:
            # Back-compat: earlier versions of this config only had a
            # single isolate_channel (one signal wire). Accept it so an
            # existing config.json doesn't silently lose its one relay
            # the moment this ships - it just won't isolate the second
            # wire until isolate_channels is set explicitly.
            single = config.get("isolate_channel")
            channels = [single] if single is not None else []
        self._isolate_channels = [c for c in channels if c is not None]

    @property
    def configured(self) -> bool:
        return self._enabled and self._up_channel is not None and self._down_channel is not None

    @property
    def managed_channel_ids(self) -> set[int]:
        """Relay channel ids this service owns. Read by the relays API
        route to refuse a plain on/off toggle on a roof channel - that
        path has no watchdog, no max-run cutoff, and no direction
        interlock, so allowing it would let the Switches screen (or a
        raw API call) drive the roof motor with nothing to stop it,
        defeating the entire hold-to-run design above.
        """
        return {c for c in (self._up_channel, self._down_channel, *self._isolate_channels) if c is not None}

    def _channel_for(self, direction: Direction) -> int:
        channel = self._up_channel if direction == "up" else self._down_channel
        if channel is None:
            raise RoofUnavailableError(f"No relay channel assigned for '{direction}'")
        return channel

    async def hold(self, direction: Direction) -> dict[str, Any]:
        """Request that the roof keeps moving. Called repeatedly while
        the user holds the button.
        """
        if not self.configured:
            raise RoofUnavailableError(
                "Roof control is not set up - assign up/down relay channels and enable it in Settings"
            )

        async with self._lock:
            now = time.monotonic()

            if self._active is not None and self._active != direction:
                # Never switch straight from one direction to the other.
                # Stop first, let the contacts settle, and make the user
                # press again - an accidental swipe across both buttons
                # should not slam the motor into reverse.
                await self._stop_locked("direction changed")
                raise RoofUnavailableError("Stopped - release and press again to change direction")

            if self._active is None:
                if now - self._last_direction_end < DIRECTION_CHANGE_PAUSE_SECONDS:
                    raise RoofUnavailableError("Too soon after the last movement - try again in a moment")
                await self._start_locked(direction, now)
            else:
                elapsed = now - self._started_at
                if elapsed >= MAX_RUN_SECONDS:
                    await self._stop_locked("maximum run time reached")
                    raise RoofUnavailableError(
                        f"Stopped after {MAX_RUN_SECONDS:.0f}s - release and press again if the roof needs to move further"
                    )
                self._last_hold_at = now

            return self.status()

    async def release(self) -> dict[str, Any]:
        """Explicit stop, sent when the user lifts their finger. The
        watchdog would catch it anyway, but this makes the common case
        immediate rather than waiting for a timeout.
        """
        async with self._lock:
            if self._active is not None:
                await self._stop_locked("released")
            return self.status()

    async def _start_locked(self, direction: Direction, now: float) -> None:
        channel = self._channel_for(direction)
        other = self._down_channel if direction == "up" else self._up_channel

        try:
            # Belt and braces: explicitly drop the opposite channel
            # before energising this one. There is a hardware interlock
            # too, but software should not rely on it to be correct.
            if other is not None:
                self._relays.set(other, False, source=f"roof:{direction}-start")
            # Isolate first, then drive - so the switch's bridge is
            # already broken before any current flows, not racing it.
            # Every isolate relay fires together - isolating only one
            # signal wire leaves the switch's bridge fully intact via
            # the other wire, doing nothing useful.
            for isolate_channel in self._isolate_channels:
                self._relays.set(isolate_channel, True, source=f"roof:{direction}-isolate")
            self._relays.set(channel, True, source=f"roof:{direction}-hold")
        except RelayUnavailableError as e:
            raise RoofUnavailableError(str(e)) from e

        self._active = direction
        self._started_at = now
        self._last_hold_at = now
        self._stopped_reason = None
        self._watchdog_task = asyncio.create_task(self._watchdog())
        logger.info("Roof movement started: %s", direction)
        record_relay_event(None, "Roof", f"hold_{direction}", f"roof:{direction}-hold")

    async def _stop_locked(self, reason: str) -> None:
        """Always de-energises BOTH direction channels, not just the
        active one, and reconnects the switch (every isolate channel)
        last. If state has somehow drifted from reality, stopping
        everything is the only safe interpretation.
        """
        for channel in (self._up_channel, self._down_channel):
            if channel is None:
                continue
            try:
                self._relays.set(channel, False, source=f"roof:stop-{reason}")
            except RelayUnavailableError as e:  # noqa: PERF203 - must attempt both regardless
                logger.error("Failed to de-energise roof channel %s: %s", channel, e)

        for isolate_channel in self._isolate_channels:
            try:
                self._relays.set(isolate_channel, False, source=f"roof:stop-{reason}")
            except RelayUnavailableError as e:
                logger.error("Failed to reconnect the roof switch (isolate channel %s): %s", isolate_channel, e)

        if self._watchdog_task and not self._watchdog_task.done():
            self._watchdog_task.cancel()
        self._watchdog_task = None

        if self._active is not None:
            logger.info("Roof movement stopped (%s) after %.1fs", reason, time.monotonic() - self._started_at)
            record_relay_event(None, "Roof", "release", f"roof:stop-{reason}", detail=reason)
        self._active = None
        self._stopped_reason = reason
        self._last_direction_end = time.monotonic()

    async def _watchdog(self) -> None:
        """Stops the roof if hold requests stop arriving, or the maximum
        run time is hit. This is the mechanism that makes a dropped
        connection safe rather than dangerous.
        """
        try:
            while True:
                await asyncio.sleep(0.2)
                async with self._lock:
                    if self._active is None:
                        return
                    now = time.monotonic()
                    if now - self._last_hold_at > WATCHDOG_SECONDS:
                        await self._stop_locked("no signal from the app")
                        return
                    if now - self._started_at >= MAX_RUN_SECONDS:
                        await self._stop_locked("maximum run time reached")
                        return
        except asyncio.CancelledError:
            raise

    async def stop_all(self) -> None:
        """Called on shutdown. A roof left energised while the backend
        goes away could not then be stopped by the app.
        """
        async with self._lock:
            await self._stop_locked("service stopping")

    def status(self) -> dict[str, Any]:
        elapsed = time.monotonic() - self._started_at if self._active else 0.0
        return {
            "configured": self.configured,
            "enabled": self._enabled,
            "up_channel": self._up_channel,
            "down_channel": self._down_channel,
            "isolate_channels": self._isolate_channels,
            "moving": self._active,
            "elapsed_seconds": round(elapsed, 1),
            "max_run_seconds": MAX_RUN_SECONDS,
            "last_stopped_reason": self._stopped_reason,
            # The app commands movement; it cannot observe it. No
            # position sensor exists, and the control unit gives no
            # feedback. Surfaced so the UI never implies otherwise.
            "position_is_unknown": True,
        }


from app.services.relay_service import relay_service  # noqa: E402 - avoids a circular import at module top

roof_service = RoofService(relay_service)
