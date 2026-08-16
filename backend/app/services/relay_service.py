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
This van's board is HIGH-TRIGGER (active_high=True): the pin is driven
HIGH to energise a circuit, LOW to release it. Confirmed against the
real board, not assumed - an earlier version of this file had it
backwards (a stale LOW-TRIGGER assumption from before the actual
hardware was tested), which is worth knowing if that claim turns up
anywhere else too. On boot, a GPIO's state is undefined until
something explicitly claims and drives it - if that happens to be
HIGH (or floats there) before this service starts, every circuit would
energise for the whole boot window (bad: the heater and fridge
switching on at every power cycle). The fix lives on the Pi, not here:
force these pins LOW from early firmware with a line in
/boot/firmware/config.txt -

    gpio=17,27,22,23,16,26,12,13=op,dl

`dl` (drive LOW), not `dh` - on a HIGH-trigger board, LOW is the safe/
released state. Getting this backwards would energise everything
during boot instead of preventing it. So the circuits stay OFF from
power-on until the app takes over. Once the app is running, losing the
Pi (off, crashed, rebooting) releases the pins; with the config.txt
guard they revert LOW = OFF on the next boot, back to physical-switch-
only control in the meantime. That's the correct failure direction for
a van: losing the Pi must never mean losing control of the lights.

STATE RESTORATION - deliberately conditional, not unconditional either
way. Every relay's commanded state IS persisted and restored across a
restart, but ONLY when the previous run shut down cleanly (stop() ran
to completion, tagging the saved state as clean). If the previous run
crashed, lost power, or was killed - anything that meant stop() never
ran - start() finds no clean-shutdown record and every relay defaults
to off instead, exactly as before this feature existed. That
distinction is the whole safety argument: a deliberate `docker compose
restart` (or a rebuild) is a controlled event you just caused
yourself, and restoring what was running before it is genuinely
useful (see the two-way-switch note below for why NOT restoring caused
real, hours-long confusion on this project). An unexpected crash while
the van is unattended is a different situation entirely, and silently
resuming whatever was running - a heater, say - without a person
present to notice is exactly the bad surprise this service has always
tried to avoid. The clean-shutdown flag is consumed (cleared) the
instant it's used, specifically so a restore can never apply twice or
reach further back than the immediately preceding session.

REAL CONSEQUENCE OF THE OLD (unconditional-off) DESIGN, worth
understanding clearly even though it's fixed now: on a two-way-wired
circuit (relay in parallel with a physical wall switch - see the
"Wiring one circuit" note in this project's wiring reference), the
actual load state is only ever "relay state AND switch position
combined" - never the relay alone. Forcing every relay to off on every
restart therefore didn't reliably mean "every load goes off" - it meant
"every load's state now depends entirely on wherever its switch
currently happens to be sitting." If a switch was positioned the other
way, that same reset could just as easily SWITCH A LOAD ON, with
nothing else changing and nobody having touched anything. That was a
genuine, hours-long mystery on this project before the cause was
found - restoring the actual previous state (this feature) sidesteps
the whole problem, rather than merely logging it more visibly.

Channels 7/8 (GPIO 24/26) are the roof reversing bridge, owned by
RoofService. A plain on/off toggle here has no watchdog, no max-run
cutoff, and no direction interlock - the safety design in
roof_service.py only applies to its own hold()/release() path. See
app/api/routes/relays.py, which refuses to energise a roof-managed
channel via the ordinary /set or /toggle routes so that safety design
can't be bypassed from the Switches screen or a direct API call.
"""

from __future__ import annotations

import logging
import time
from typing import Any

logger = logging.getLogger("vanos.relay_service")


def record_relay_event(channel_id: int | None, channel_name: str, action: str, source: str, detail: str | None = None) -> None:
    """Durable audit-trail record of a relay/roof event - the fix for a
    real gap found tonight: the log line already carried this
    information, but only ever lived in Docker's own stdout log, which
    rotates away on a rebuild (the exact reason one night's "why did
    the light come on" took hours to resolve instead of minutes).
    Same "never let this break the actual operation" contract as
    location_service's history logging - a DB failure here must never
    prevent a relay from actually switching.
    """
    from app.db.database import SessionLocal
    from app.db.models import RelayEvent

    db = SessionLocal()
    try:
        db.add(
            RelayEvent(
                timestamp=time.time(),
                channel_id=channel_id,
                channel_name=channel_name,
                action=action,
                detail=detail,
                source=source,
            )
        )
        db.commit()
    except Exception as e:  # noqa: BLE001 - never let audit logging break a relay command
        logger.warning("Failed to record relay event: %s", e)
        db.rollback()
    finally:
        db.close()

# Default channel map, used only if config.json has no "relays" section.
# GPIO 4 is deliberately avoided - that's the 1-Wire temperature bus, and
# GPIOs 5/6/7 carry the DS18B20 sensors on this build. GPIO 14/15 (UART
# console) and 2/3 (I2C) are avoided too. 24/26 are free, ordinary GPIO
# with no on-board function on this build (GPIO 25/pin 22 was tried
# first but that specific header pin proved dead on this Pi - see the
# note by relay 8 below). All of these are in the
# pull-down-by-default range; on this LOW-trigger board that means
# they'd energise at boot without the config.txt guard (see the module
# docstring). Names mirror the seeded config in configuration_service.py.
DEFAULT_CHANNELS = [
    {"id": 1, "gpio": 17, "name": "Heater"},
    # inverted: True - confirmed 13 Aug via a clean, repeatable 3-for-3
    # inversion (commanded ON -> bulb dark, commanded OFF -> bulb lit,
    # switch untouched throughout) - see the note where this is
    # consumed in start() for the full reasoning.
    {"id": 2, "gpio": 27, "name": "Lights", "inverted": True},
    {"id": 3, "gpio": 22, "name": "Radio / amp"},
    {"id": 4, "gpio": 23, "name": "Fridge / TV"},
    {"id": 7, "gpio": 16, "name": "Roof up"},
    # GPIO 25 (physical pin 22) was the original pick here, but proved
    # dead on this specific Pi - continuity-tested good wire, good relay
    # channel (it lit fine once moved to a different pin), yet pin 22
    # itself never did anything. Moved to GPIO 26 (pin 37) rather than
    # spend more time diagnosing a single flaky header pin.
    {"id": 8, "gpio": 26, "name": "Roof down"},
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
        self._backfill_new_channel_fields()

    def _backfill_new_channel_fields(self) -> None:
        """A saved config.json's "relays.channels" list, once written
        (e.g. via a rename), shadows DEFAULT_CHANNELS entirely - so a
        field added to DEFAULT_CHANNELS later (like "inverted" here)
        silently doesn't reach an existing install's saved channels at
        all, not even after a deploy, until someone hand-edits the
        JSON. Back-fill any DEFAULT_CHANNELS field that's genuinely
        absent (not just falsy - a deliberate False must stick) from
        the matching saved channel by id, so new optional metadata
        reaches existing installs the same way a brand new "relays"
        section already does.
        """
        defaults_by_id = {c["id"]: c for c in DEFAULT_CHANNELS}
        for channel in self._channels:
            default = defaults_by_id.get(channel.get("id"))
            if not default:
                continue
            for key, value in default.items():
                if key not in channel:
                    channel[key] = value

    def start(self) -> None:
        """Claims the GPIO pins. Failure here is non-fatal and expected
        on any machine without GPIO (a dev laptop, this project's CI) -
        the rest of the app must keep working, with the relay feature
        reporting itself unavailable rather than taking the backend down.

        Every channel ALWAYS starts OFF, unconditionally, on every
        single startup - no exceptions, no restoring a previous state.
        This used to restore each channel's last commanded state after
        a clean shutdown - removed entirely after a real, reported
        incident: the reload-backend button (a genuinely graceful
        SIGTERM-based restart, not a crash) brought a light back on
        that had deliberately been turned off. The underlying save/
        restore bookkeeping was working exactly as designed even then
        - it was the DESIGN ITSELF, not a bug in it, that was unsafe:
        restoring "whatever was last commanded" is a guess at best on
        a two-way-wired circuit the app can't actually sense (see the
        module docstring), and guessing wrong means a real 12V circuit
        - potentially the heater - re-energising with nobody having
        asked for that, right when a backend restart is already
        underway. Every startup now leaves every channel in the one
        state that's unconditionally safe regardless of what was
        happening before: off, requiring an explicit new command
        either way.
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
                channel_id = channel["id"]

                # Board-wide active_high, XOR'd with a per-channel
                # "inverted" flag for a circuit whose physical path
                # (relay wiring, or something else specific to that one
                # circuit) results in the opposite of what the board's
                # own trigger polarity would normally produce - not
                # claiming to know the exact physical cause, just
                # correcting the observed behaviour. Confirmed on
                # relay 2 (Lights) the night of 13 Aug: three consecutive
                # tests logged a perfectly consistent, deterministic
                # inversion (commanded ON -> bulb stayed dark, commanded
                # OFF -> bulb lit, repeated identically with no switch
                # touched in between) - that clean, repeatable pattern is
                # what a physical wiring mistake looks like, not
                # switch-position ambiguity, which would be inconsistent
                # from test to test rather than perfectly opposite every
                # single time.
                effective_active_high = self._active_high != bool(channel.get("inverted", False))

                # Reported live: Lights - and ONLY Lights, every other
                # channel unaffected - turning ON during every reload,
                # then off again once the app finished starting.
                # Real bug, found by reading gpiozero's own behaviour
                # for active_high=False (which is exactly what Lights
                # gets, being the one inverted channel): initial_value
                # is a LOGICAL value, translated through active_high -
                # for an active_high=False device, initial_value=False
                # actually drives the PHYSICAL pin HIGH, not low. On
                # this high-trigger board, a high pin energises the
                # relay - so "start it off" was accidentally telling
                # the hardware to switch Lights ON, for exactly the one
                # channel where active_high comes out False. Every
                # other channel is active_high=True, where False
                # correctly means physically low - which is why nothing
                # else was ever affected.
                #
                # Fix: compute whichever initial_value actually produces
                # a physically LOW pin (safe/de-energised on this
                # high-trigger board) for THIS channel's own polarity,
                # rather than assuming False always means "safe" -
                # normal channels: not True = False (unchanged).
                # Lights (active_high=False): not False = True - passing
                # True is what correctly drives ITS physical pin low.
                # self._commanded stays False either way - that's the
                # app's own logical "is this on" bookkeeping, separate
                # from whatever value gpiozero needed to reach a
                # physically safe pin state.
                physically_off_value = not effective_active_high
                device = OutputDevice(
                    channel["gpio"],
                    active_high=effective_active_high,
                    initial_value=physically_off_value,
                )
                self._devices[channel_id] = device
                self._commanded[channel_id] = False

                logger.info("Relay %s starting OFF (via system:startup)", channel_id)
                record_relay_event(
                    channel_id, channel["name"], "reset-off", "system:startup",
                    detail="every startup always begins with every relay off",
                )
            self._available = True
            logger.info("Relay control ready on %d channel(s)", len(self._devices))
        except Exception as e:  # noqa: BLE001 - no GPIO hardware is a normal dev-machine state
            self._unavailable_reason = str(e)
            logger.warning("Relay control unavailable - %s", e)
            self._release()

    def stop(self) -> None:
        """Turns everything off and releases the pins. No longer
        persists anything for a future startup to restore - see
        start()'s own docstring for why that was removed entirely,
        not just fixed."""
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

    def rename(self, channel_id: int, name: str) -> dict[str, Any]:
        """Renames a channel and persists it.

        Applied to the in-memory channel list as well as saved, so it
        takes effect immediately rather than on next restart - "Relay
        2" is useless enough that making someone reboot to fix it
        would be a poor experience.

        Deliberately does NOT touch the GPIO mapping. A rename should
        never be able to silently point a label at different hardware;
        if a channel needs a different pin, that's a config edit, not a
        UI action.
        """
        channel = next((c for c in self._channels if c["id"] == channel_id), None)
        if channel is None:
            raise RelayUnavailableError(f"No relay channel with id {channel_id}")

        cleaned = name.strip()
        if not cleaned:
            raise RelayUnavailableError("Name cannot be empty")
        # Bounded so a paste accident can't write an unbounded string
        # into the config file.
        channel["name"] = cleaned[:48]

        from app.services.configuration_service import configuration_service

        relay_config = configuration_service.get("relays", {})
        relay_config["channels"] = [dict(c) for c in self._channels]
        configuration_service.set("relays", relay_config)

        return self.status()

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

    def set(self, channel_id: int, on: bool, source: str = "unspecified") -> dict[str, Any]:
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
        # `source` is what makes this log line actually answer "what
        # caused this" rather than just "channel X changed at time Y" -
        # e.g. "via app:switches" vs "via roof:up-hold" vs
        # "via app:all-off". Every real caller in the codebase now
        # passes one explicitly (see relays.py and roof_service.py);
        # "unspecified" only shows up if a new call site forgets to.
        logger.info("Relay %s commanded %s (via %s)", channel_id, "ON" if on else "OFF", source)
        channel_name = next((c["name"] for c in self._channels if c["id"] == channel_id), f"Relay {channel_id}")
        record_relay_event(channel_id, channel_name, "on" if on else "off", source)
        return self.status()

    def toggle(self, channel_id: int, source: str = "unspecified") -> dict[str, Any]:
        return self.set(channel_id, not self._commanded.get(channel_id, False), source=source)

    def all_off(self, source: str = "unspecified") -> dict[str, Any]:
        for channel in self._channels:
            if self._available:
                self.set(channel["id"], False, source=source)
        return self.status()


relay_service = RelayService()
