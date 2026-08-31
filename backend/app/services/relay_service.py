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
project avoids elsewhere - battery SoC was left blank for months rather
than inferred from voltage, humidity is absent because there is no
sensor, and AI-generated content is labelled as such.

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
#
# PHYSICAL PIN NUMBERS are what this van is wired and documented by; the
# `gpio` key is a BCM number only because that is what gpiozero's
# constructor takes. The mapping, so nobody has to look it up:
# GPIO 17 = pin 11, GPIO 27 = pin 13, GPIO 22 = pin 15, GPIO 23 = pin 16,
# GPIO 12 = pin 32, GPIO 13 = pin 33, GPIO 16 = pin 36, GPIO 26 = pin 37.
#
# `in_use` (default True when absent) means "this channel switches a
# circuit that actually exists". A channel set False is still wired,
# still togglable from the Switches screen for bench testing, and still
# has its pin claimed and held safe at boot - it is simply not offered
# by voice and not listed to Ron as something he can tell you to
# switch. See set_in_use() for why that distinction is worth a flag
# rather than a rename.
DEFAULT_CHANNELS = [
    # Pin 11. Named Heater until 31 Aug 2026; the diesel heater is now
    # fed direct from the battery and never went through a relay in its
    # final wiring, so this channel carries the TV circuit.
    # NOTE: this channel has a HARDWARE FAULT on the Hailege board - the
    # Pi drives the pin correctly and the relay does not actuate. A
    # spare 5V relay module is the intended fix. It is left in_use=True
    # deliberately: it is a broken circuit to repair, not a
    # decommissioned one.
    {"id": 1, "gpio": 17, "name": "TV"},
    # Pin 13. inverted: True - confirmed 13 Aug via a clean, repeatable
    # 3-for-3 inversion (commanded ON -> bulb dark, commanded OFF ->
    # bulb lit, switch untouched throughout) - see the note where this
    # is consumed in start() for the full reasoning.
    {"id": 2, "gpio": 27, "name": "Lights", "inverted": True},
    # Pin 15.
    {"id": 3, "gpio": 22, "name": "Amp"},
    # Pin 16. This was the diesel heater's channel. The heater now runs
    # direct off the battery (the 1.4V drop through the relay board was
    # a real, measured contributor to its ignition failures), so this
    # channel switches NOTHING - it is a spare with a relay behind it
    # and no load in front of it. in_use=False so Ron stops offering to
    # switch a heater that isn't on a relay any more.
    {"id": 4, "gpio": 23, "name": "Spare", "in_use": False},
    # Pin 36.
    {"id": 7, "gpio": 16, "name": "Roof up"},
    # Pin 37. GPIO 25 (physical pin 22) was the original pick here, but
    # proved dead on this specific Pi - continuity-tested good wire,
    # good relay channel (it lit fine once moved to a different pin),
    # yet pin 22 itself never did anything. Moved to GPIO 26 (pin 37)
    # rather than spend more time diagnosing a single flaky header pin.
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

    @staticmethod
    def _roof_channel_ids() -> set[int] | None:
        """Relay channels that drive the roof, read STRAIGHT FROM CONFIG
        rather than from roof_service.managed_channel_ids.

        That indirection is deliberate and load-bearing. relay_service
        .start() is the FIRST thing main.py's lifespan does (166e743,
        so the pins are claimed before anything else can float them),
        while roof_service.configure() runs much later in the same
        lifespan. Asking roof_service at restore time therefore returns
        an EMPTY set - it has not been configured yet - and every roof
        guard built on it would silently pass while looking correct.
        Reading the same `roof` config section directly is the only
        source available this early.

        Returns None if the config cannot be read, which callers must
        treat as "assume EVERY channel is a roof channel". Fail closed:
        wrongly skipping a restore costs a lamp that needs switching
        back on by hand, wrongly restoring costs a roof motor running
        with no watchdog."""
        try:
            from app.services.configuration_service import configuration_service

            roof = configuration_service.get("roof", {}) or {}
            isolate = roof.get("isolate_channels") or []
            ids = {roof.get("up_channel"), roof.get("down_channel"), *isolate}
            return {int(i) for i in ids if i is not None}
        except Exception as e:  # noqa: BLE001
            logger.error(
                "Could not read roof channels from config (%s) - treating ALL channels as roof "
                "and restoring none, rather than risk energising a roof motor at startup",
                e,
            )
            return None

    def _is_roof_channel(self, channel_id: int, roof_ids: set[int] | None) -> bool:
        """None means the roof config was unreadable - see above."""
        return roof_ids is None or channel_id in roof_ids

    def start(self) -> None:
        """Claims the GPIO pins. Failure here is non-fatal and expected
        on any machine without GPIO (a dev laptop, this project's CI) -
        the rest of the app must keep working, with the relay feature
        reporting itself unavailable rather than taking the backend down.

        Restores each channel's PREVIOUS commanded state, but only if
        the previous run shut down cleanly (see stop() - it tags the
        saved state, and _consume_clean_shutdown_state() consumes/
        clears that tag immediately so it can never be reused by a
        later crash). No clean-shutdown record at all - first-ever
        boot, or the previous run crashed - and every channel defaults
        to off.

        This restore behaviour was REMOVED entirely earlier tonight,
        then reinstated after real pushback that correctly identified
        a genuine mistake, not just a disagreement: on a two-way
        (staircase) wired circuit, "relay off" does not mean "load
        off" - it depends on which side the physical switch is
        currently on. If a switch sits on the relay's NC side,
        commanding the relay ON is what's actually needed to keep that
        load off. Removing the restore behaviour meant every restart
        forced every relay back to the "off" COMMAND regardless of
        what state was actually needed for that switch position -
        correct for circuits switched to the NO side, exactly backwards
        for circuits switched to NC. The original restore-last-state
        design was doing real, correct work for exactly this reason -
        the mistake was removing it, not the design itself.
        """
        if not self._channels:
            self.configure()

        try:
            from gpiozero import OutputDevice
        except ImportError as e:
            self._unavailable_reason = f"gpiozero not installed: {e}"
            logger.warning("Relay control unavailable - %s", self._unavailable_reason)
            return

        restore_state, clean = self._consume_clean_shutdown_state()
        roof_ids = self._roof_channel_ids()

        try:
            for channel in self._channels:
                channel_id = channel["id"]
                # The LOGICAL "should this channel be commanded on"
                # state - restored from a clean-shutdown record if one
                # exists, defaulting to off otherwise (first boot, or
                # the previous run crashed without ever reaching stop()).
                logical_on = bool(restore_state.get(str(channel_id), False)) if clean else False

                # ROOF CHANNELS ARE NEVER RESTORED ON. Hard override,
                # applied after the record is read and regardless of
                # what it says.
                #
                # Restoring the last commanded state is correct for a
                # lamp or an amp: the load simply resumes, and the user
                # asked for it. It is NOT correct for a roof motor. The
                # whole roof design is hold-to-run - a watchdog that
                # drops the relay within 1.5s of requests stopping, a
                # 30s max-run ceiling, a direction interlock - and none
                # of that exists at startup. A restored roof-ON is a
                # motor running with nobody holding anything.
                #
                # This became reachable when relay state moved to
                # write-through persistence (every command saved
                # immediately, not just at a graceful shutdown). Before
                # that, capturing a roof-ON needed a clean shutdown to
                # land inside a hold - vanishingly unlikely. After it,
                # any power cut or crash during a hold persists roof-ON,
                # and a van losing power mid-hold is an ordinary event,
                # not an exotic one. The write-through fix was right;
                # this is the guard it needed alongside it.
                if logical_on and self._is_roof_channel(channel_id, roof_ids):
                    logger.warning(
                        "Relay %s (%s) was commanded ON at shutdown but is a roof channel - "
                        "forcing OFF. The roof only moves through the hold-to-run path.",
                        channel_id, channel.get("name", "?"),
                    )
                    logical_on = False

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

                # gpiozero's initial_value is a LOGICAL value and gpiozero
                # itself translates it through active_high - exactly the
                # same translation device.on()/device.off() get at runtime.
                # So it must be passed straight through. An earlier fix
                # (a8a8de6) pre-inverted it here for the active_high=False
                # channel, which meant the inversion was applied TWICE -
                # once here, once inside gpiozero - and cancelled out.
                # Net effect, measured: for the one inverted channel
                # (Lights) the startup path drove the pin the OPPOSITE way
                # from the runtime path for the same logical state
                # (restored ON -> pin HIGH, but commanding ON at runtime ->
                # pin LOW). Every other channel was consistent because
                # effective_active_high is True for them, where the
                # pre-inversion was a no-op - which is exactly why Lights,
                # and only Lights, kept coming back wrong after a restart.
                # Passing the logical value directly makes startup and
                # runtime agree by construction, for either polarity.
                initial_value = logical_on
                device = OutputDevice(
                    channel["gpio"],
                    active_high=effective_active_high,
                    initial_value=initial_value,
                )
                self._devices[channel_id] = device
                self._commanded[channel_id] = logical_on

                if clean:
                    logger.info(
                        "Relay %s restored to %s (via system:startup-restore, last state before clean shutdown)",
                        channel_id, "ON" if logical_on else "OFF",
                    )
                    record_relay_event(
                        channel_id, channel["name"], "restored" if logical_on else "restored-off",
                        "system:startup-restore", detail="last state before clean shutdown",
                    )
                else:
                    logger.info("Relay %s reset to OFF (via system:startup, no clean-shutdown record)", channel_id)
                    record_relay_event(
                        channel_id, channel["name"], "reset-off", "system:startup",
                        detail="no clean-shutdown record",
                    )
            self._available = True
            # Re-persist immediately: _consume_clean_shutdown_state()
            # cleared the record, so without this a second restart
            # BEFORE any command would find nothing and default all-off.
            # With write-through the consume-once protection matters
            # less anyway (the record can't be stale), but keep both.
            self._persist_commanded_state()
            logger.info("Relay control ready on %d channel(s)", len(self._devices))
        except Exception as e:  # noqa: BLE001 - no GPIO hardware is a normal dev-machine state
            self._unavailable_reason = str(e)
            logger.warning("Relay control unavailable - %s", e)
            self._release()

    def _consume_clean_shutdown_state(self) -> tuple[dict[str, Any], bool]:
        """Reads AND clears the clean-shutdown record in one step, so a
        restore can only ever be applied once. Any read/parse failure
        is treated as "no record" (safe default), never as a reason to
        fail startup."""
        try:
            from app.services.configuration_service import configuration_service

            saved = configuration_service.get("relays_runtime_state", {}) or {}
            configuration_service.set("relays_runtime_state", {})  # consume immediately
            if saved.get("clean_shutdown") is True:
                return dict(saved.get("channels", {})), True
        except Exception as e:  # noqa: BLE001 - a bad persisted record must never block startup
            logger.warning("Could not read previous relay state, defaulting to off: %s", e)
        return {}, False

    def _persist_commanded_state(self) -> None:
        """Write-through persistence of the commanded state.

        Called after EVERY successful relay command, not just at
        shutdown. This exists because of a bug found live on 16 Aug
        2026: `docker compose up -d --build` does not reliably run the
        graceful shutdown path, so a shutdown-only save could be
        skipped - and then the NEXT start would restore whatever an
        OLDER graceful stop had saved. Observed exactly that: the
        heater restored to a state from two restarts ago, dropping a
        commanded-ON channel and looking like it "turned itself off".
        With write-through, the record always matches the last command
        issued and it no longer matters whether shutdown was graceful.

        The `clean_shutdown` tag is kept (start() still requires it)
        but its meaning is now "state is trustworthy" rather than
        "stop() ran" - it is true from the first command onwards."""
        try:
            from app.services.configuration_service import configuration_service

            # Roof channels are persisted as OFF whatever they are doing
            # right now. Belt and braces with the startup guard in
            # start(): that one stops a roof-ON being ACTED on, this one
            # stops it being RECORDED at all, so the hazardous value
            # never reaches disk even if the startup guard is later
            # changed or bypassed. A roof hold is transient by
            # definition - there is no state there worth carrying across
            # a restart, so nothing is lost by never saving it.
            roof_ids = self._roof_channel_ids()
            channels = {
                str(k): (False if self._is_roof_channel(k, roof_ids) else v)
                for k, v in self._commanded.items()
            }

            configuration_service.set(
                "relays_runtime_state",
                {
                    "clean_shutdown": True,
                    "channels": channels,
                    "saved_at": time.time(),
                },
            )
        except Exception as e:  # noqa: BLE001 - persistence must never block relay control
            logger.warning("Could not persist relay state for next startup: %s", e)

    def stop(self) -> None:
        """Persists the current commanded state one final time (now
        redundant in the normal case - every command already
        write-through persisted - but kept as a belt-and-braces final
        snapshot) before turning everything off and releasing the pins.
        The relays themselves always end up physically off HERE, at
        shutdown - restoring the commanded state is entirely start()'s
        job, on the NEXT run, not something this method does itself."""
        self._persist_commanded_state()

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

    def set_in_use(self, channel_id: int, in_use: bool) -> dict[str, Any]:
        """Marks a channel as switching a real circuit, or not.

        Exists because renaming a decommissioned channel to "Spare"
        is not enough. The relay list is what tells the voice layer
        which circuits exist and what to call them, and it is also
        what Ron reads to answer "what can you switch?". A channel
        left in that list under any name is a channel Ron will offer,
        and a phrase the voice matcher will act on - so after the
        diesel heater came off the relay board, Ron went on
        confidently telling people to say "turn the heater on" for a
        circuit that no longer existed. Renaming it to "Spare" would
        have swapped one wrong offer for a meaningless one.

        Deliberately does NOT release the pin or stop the channel
        working. The pin stays claimed and driven safe at boot (which
        is the whole point of claiming it), the Switches screen can
        still toggle it, and a multimeter on COM/NO still proves the
        board out - all of which you want when the spare is about to
        have something wired to it. The flag scopes exactly one thing:
        whether this channel is offered as a load a person can name.
        """
        channel = next((c for c in self._channels if c["id"] == channel_id), None)
        if channel is None:
            raise RelayUnavailableError(f"No relay channel with id {channel_id}")

        channel["in_use"] = bool(in_use)

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
                    # Absent means True. A channel that predates this
                    # flag is one that was wired to something, so the
                    # safe default is "yes, it's real" - the flag has to
                    # be set deliberately to take a channel out of
                    # voice control, never inferred.
                    "in_use": bool(c.get("in_use", True)),
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
        # Write-through: persist immediately so a hard kill / rebuild
        # can never restore a stale state (see _persist_commanded_state).
        self._persist_commanded_state()
        return self.status()

    def toggle(self, channel_id: int, source: str = "unspecified") -> dict[str, Any]:
        return self.set(channel_id, not self._commanded.get(channel_id, False), source=source)

    def all_off(self, source: str = "unspecified") -> dict[str, Any]:
        for channel in self._channels:
            if self._available:
                self.set(channel["id"], False, source=source)
        return self.status()


relay_service = RelayService()
