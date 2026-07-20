"""
RelayService — switches 12V circuits via a GPIO-driven relay board.

IMPORTANT HONESTY CONSTRAINT, which shapes this whole design:
the relays are wired in PARALLEL with the van's existing physical
switch panel, so either can energise a circuit independently. That
means this service knows what IT last commanded, but CANNOT know
whether a circuit is actually live - someone may have flipped the
physical switch, and there's no sense line back to tell us. Every
piece of state here is therefore named and reported as "commanded",
never "actual", and the UI says so plainly. Claiming to know the true
circuit state would be inventing information, the same thing this
project avoids with battery SoC (no shunt), humidity (no sensor), and
AI-generated content.

Uses gpiozero with the lgpio backend - the current supported approach
on Raspberry Pi OS Bookworm. RPi.GPIO is deliberately avoided: it
relies on /dev/mem and doesn't work on Pi 5, so it's a dead end.

SAFETY / FAILURE BEHAVIOUR:
On boot, Pi GPIOs 9-27 default to pull-down (LOW). With the relay
board's trigger jumper set to HIGH, LOW means de-energised, so every
circuit comes up OFF and reverts to physical-switch-only control if
the Pi is off, crashed, or rebooting. That's the correct failure
direction for a van: losing the Pi must never mean losing the lights.
This is also why commanded state is deliberately NOT restored
automatically after a restart - silently re-energising circuits on
boot is a genuinely bad surprise.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("vanos.relay_service")

# Default channel map. GPIO 4 is deliberately avoided - that's the
# 1-Wire temperature bus. These four are all in the pull-down-by-default
# range, so they read LOW at boot (relay off with a HIGH-trigger board).
DEFAULT_CHANNELS = [
    {"id": 1, "gpio": 17, "name": "Relay 1"},
    {"id": 2, "gpio": 27, "name": "Relay 2"},
    {"id": 3, "gpio": 22, "name": "Relay 3"},
    {"id": 4, "gpio": 23, "name": "Relay 4"},
]


class RelayUnavailableError(RuntimeError):
    pass


class RelayService:
    def __init__(self) -> None:
        self._devices: dict[int, Any] = {}
        self._channels: list[dict[str, Any]] = []
        self._commanded: dict[int, bool] = {}
        self._available = False
        self._unavailable_reason: str | None = None
        # active_high=True matches a board with its trigger jumper set
        # to HIGH: driving the pin HIGH energises the relay. Set false
        # for a LOW-trigger board (or one without a selectable jumper).
        self._active_high = True

    def configure(self, channels: list[dict[str, Any]] | None = None, active_high: bool = True) -> None:
        self._channels = channels if channels else list(DEFAULT_CHANNELS)
        self._active_high = active_high

    def start(self) -> None:
        """Claims the GPIO pins. Failure here is non-fatal and expected
        on any machine without GPIO (a dev laptop, this project's CI) -
        the rest of the app must keep working, with the relay feature
        reporting itself unavailable rather than taking the backend down.
        """
        if not self._channels:
            self.configure()

        try:
            from gpiozero import OutputDevice
        except ImportError as e:
            self._unavailable_reason = f"gpiozero not installed: {e}"
            logger.warning("Relay control unavailable - %s", self._unavailable_reason)
            return

        try:
            for channel in self._channels:
                device = OutputDevice(
                    channel["gpio"],
                    active_high=self._active_high,
                    # Explicit: never energise a circuit just because
                    # the service started.
                    initial_value=False,
                )
                self._devices[channel["id"]] = device
                self._commanded[channel["id"]] = False
            self._available = True
            logger.info("Relay control ready on %d channel(s)", len(self._devices))
        except Exception as e:  # noqa: BLE001 - no GPIO hardware is a normal dev-machine state
            self._unavailable_reason = str(e)
            logger.warning("Relay control unavailable - %s", e)
            self._release()

    def stop(self) -> None:
        """Turns everything off before releasing the pins - leaving a
        circuit energised after the service stops would mean the app
        can no longer switch it off.
        """
        for channel_id, device in self._devices.items():
            try:
                device.off()
                self._commanded[channel_id] = False
            except Exception as e:  # noqa: BLE001 - best effort during shutdown
                logger.warning("Failed turning off relay %s during shutdown: %s", channel_id, e)
        self._release()

    def _release(self) -> None:
        for device in self._devices.values():
            try:
                device.close()
            except Exception:  # noqa: BLE001 - best effort
                pass
        self._devices.clear()
        self._available = False

    @property
    def available(self) -> bool:
        return self._available

    def status(self) -> dict[str, Any]:
        return {
            "available": self._available,
            "reason": self._unavailable_reason if not self._available else None,
            # Surfaced so the UI can be explicit about what this state
            # does and doesn't mean.
            "state_is_commanded_only": True,
            "channels": [
                {
                    "id": c["id"],
                    "gpio": c["gpio"],
                    "name": c["name"],
                    "commanded_on": self._commanded.get(c["id"], False),
                }
                for c in self._channels
            ],
        }

    def set(self, channel_id: int, on: bool) -> dict[str, Any]:
        if not self._available:
            raise RelayUnavailableError(self._unavailable_reason or "Relay control is not available on this system")
        device = self._devices.get(channel_id)
        if device is None:
            raise RelayUnavailableError(f"Unknown relay channel {channel_id}")

        try:
            if on:
                device.on()
            else:
                device.off()
        except Exception as e:  # noqa: BLE001
            raise RelayUnavailableError(f"Failed switching relay {channel_id}: {e}") from e

        self._commanded[channel_id] = on
        logger.info("Relay %s commanded %s", channel_id, "ON" if on else "OFF")
        return self.status()

    def toggle(self, channel_id: int) -> dict[str, Any]:
        return self.set(channel_id, not self._commanded.get(channel_id, False))

    def all_off(self) -> dict[str, Any]:
        for channel in self._channels:
            if self._available:
                self.set(channel["id"], False)
        return self.status()


relay_service = RelayService()
