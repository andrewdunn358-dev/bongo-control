#!/usr/bin/env python3
"""
VanOS heater agent — runs on the Pi HOST, not in the container.

Owns the Bluetooth link to the Hcalory heater and exposes it over plain
HTTP on 127.0.0.1, so the VanOS backend never touches Bluetooth for the
heater at all.

THE BUG THAT COST TWO DAYS: POLL WITH THE STATUS QUERY, NOT THE CLOCK
The heater used to terminate the connection every 6-19 seconds. HCI
reason 0x13, Remote User Terminated - it was deliberately hanging up.

`diesel-heater-ble`'s `build_command(1, ...)` on an MVP2 device returns
the `0A0A` packet, and that is the TIME-SYNC command: it carries
HH:MM:SS and the heater sets its clock from it. We were polling with it
once a second. Every second, telling the heater to reset its clock. It
put up with that for a few seconds and then hung up.

See `_query()` below - it builds the plain `0E04` status request
directly instead. The time sync is sent once, on connect, which is what
the working Home Assistant integration does.

Everything else investigated along the way was a red herring or a minor
real issue that was not the cause: the shared BLE scan, an idle
timeout, BleakClient's service cache, a second Bluetooth adapter,
BlueZ's stored connection parameters. Recorded in
claude_hcalory-heater-plugin.md so nobody re-treads them.

WHICH ADAPTER (HEATER_ADAPTER, default hci0)
`hci0`, shared with the container's Victron scan. That works, now the
poll command is right.

A USB dongle on `hci1` was tried while the poll bug was still present.
It connected more reliably but still dropped, then wedged and needed a
physical unplug to recover - it survived a reboot in that state. It was
never the fix and is not needed. Change this only if there is a
specific reason and the dongle is confirmed healthy with `hciconfig -a`.

WHY IT LIVES OUT HERE
The backend container already runs a continuous BLE discovery scan for
the Victron MPPT and SmartShunt. BlueZ permits one discovery session
per adapter, so a GATT connect from the same process collided with it:

    [org.bluez.Error.InProgress] Operation already in progress

Stopping the shared scan around the connect was tried and made things
worse - BlueZ then reported "No Bluetooth adapters found" and the
Victron plugins were at risk. Battery and solar monitoring matter more
than the heater, so the heater gets moved out of the way rather than
the other way round.

Out here it has its own process and its own BlueZ session. The
container keeps its scan uninterrupted; nothing this agent does can
take the Victron plugins down, and if the agent dies the backend simply
reports the heater as unavailable.

The standalone test connected first time from the host, repeatedly,
while the container could not - so this is also the arrangement that is
known to work rather than a hopeful one.

PROTOCOL
Hcalory MVP2, service BD39, write BDF7, notify BDF8, PIN 0000. Requires
a password handshake immediately after connecting or the heater drops
the link. Packets built and parsed by diesel-heater-ble.

INSTALL
    sudo pip3 install bleak bleak-retry-connector diesel-heater-ble --break-system-packages
    sudo cp backend/tools/vanos-heater-agent.service /etc/systemd/system/
    sudo systemctl enable --now vanos-heater-agent

    curl 127.0.0.1:8091/state
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("heater-agent")

MAC = os.environ.get("HEATER_MAC", "20:25:05:19:0D:33")
PIN = int(os.environ.get("HEATER_PIN", "0"))
PORT = int(os.environ.get("HEATER_AGENT_PORT", "8091"))
# Which Bluetooth adapter to use. THIS MATTERS - see the note below.
ADAPTER = os.environ.get("HEATER_ADAPTER", "hci0")
# 1 second, matching the official app. Not a guess about efficiency:
# at 10s the link was observed dropping after ~11s twice - one poll
# cycle plus a moment - which points at an idle timeout on the heater.
# The app never goes quiet, and neither should this.
POLL_SECONDS = float(os.environ.get("HEATER_POLL_SECONDS", "1"))

MVP2_WRITE = "0000bdf7-0000-1000-8000-00805f9b34fb"
MVP2_NOTIFY = "0000bdf8-0000-1000-8000-00805f9b34fb"

CONNECT_TIMEOUT = 45.0
REPLY_TIMEOUT = 12.0
# Deliberately low. Connecting to this heater is intermittent - roughly
# one attempt in several succeeds regardless of settings - so the right
# response to a failure is to try again shortly, not to sulk. A 120s
# ceiling meant a device that reconnects readily sat unreachable for two
# minutes at a time, and made the failure look worse than it was.
MAX_BACKOFF = 15.0

CMD_STATUS, CMD_SET_MODE, CMD_POWER, CMD_SET_TEMPERATURE, CMD_SET_LEVEL = 1, 2, 3, 4, 5

# The library maps the heater's raw running_step onto its own standard
# set: 0 standby, 2 ignition, 3 running, 4 cooldown, 6 ventilation.
# The first version of this file used the RAW values (ignition 0x3,
# cooldown 0x4) - but 3 in the mapped set is RUNNING, so the ignition
# guard would have refused to stop a running heater and offered no
# protection during actual ignition. Exactly backwards. These are the
# mapped values, checked against the library's step_mapping.
STEP_IGNITION, STEP_RUNNING, STEP_COOLDOWN, STEP_VENTILATION = 2, 3, 4, 6

# Litres per hour by gear, 1-10. From the Home Assistant integration's
# FUEL_CONSUMPTION_TABLE, whose own comment is worth repeating:
# "computed locally, not protocol-dependent". The heater does NOT report
# fuel use - this is an estimate from the gear it is running at.
#
# It is a reasonable estimate rather than a guess: these pumps are
# fixed-displacement and the gear sets the pump frequency directly, so
# consumption really is a function of gear. But it is still modelled,
# and anything built on it should say so rather than presenting it as
# a measurement.
#
# THIS MATTERS MORE ON THIS VAN THAN MOST. The heater is plumbed into
# the VEHICLE fuel tank, not a separate one, so what it burns overnight
# comes straight off driving range.
FUEL_LITRES_PER_HOUR = {
    1: 0.16, 2: 0.20, 3: 0.24, 4: 0.28, 5: 0.32,
    6: 0.36, 7: 0.40, 8: 0.44, 9: 0.48, 10: 0.52,
}

# hcalory_status - the high nibble of the state byte. What the heater
# is actually doing, as opposed to running_state which is just 0/1.
STATUS_OFF, STATUS_TURNING_OFF, STATUS_HEATING, STATUS_VENTILATION, STATUS_ERROR = 0x0, 0x4, 0x8, 0xC, 0xF


def fuel_rate_lph(state: dict) -> float | None:
    """Estimated current burn rate in litres/hour, or None when not
    burning.

    Returns None rather than 0.0 while ventilating or off: the fan uses
    no fuel, and a rate of zero would integrate correctly but reads as
    "we measured zero" rather than "it is not burning".

    In temperature mode the heater picks its own gear, and the reported
    `set_value` is the TARGET TEMPERATURE, not a gear - feeding that
    into the table would read 21C as gear 21 and fall off the end of it.
    Until the running gear can be read directly, temperature mode
    estimates at mid-range and flags itself as approximate.
    """
    status = state.get("state")

    if status != STATUS_HEATING:
        return None

    mode = state.get("mode")
    target = state.get("target")

    if mode == 1 and isinstance(target, int) and target in FUEL_LITRES_PER_HOUR:
        return FUEL_LITRES_PER_HOUR[target]

    # Temperature mode, or a gear we cannot read: mid-table.
    return FUEL_LITRES_PER_HOUR[5]


def shape_state(parsed: dict) -> dict:
    """Map the library's parse output onto the fields VanOS uses.

    Module-level and pure so it can be tested without a heater. It was
    previously inline in _query(), which meant the only way to test it
    was to copy it into the test - and a test of a copy proves nothing
    about the code that runs.
    """
    step = parsed.get("running_step")
    mode = parsed.get("running_mode")

    # Target lives in set_temp or set_level depending on mode, and is
    # absent entirely while the heater is off (the library sets
    # hcalory_set_value_none rather than inventing one). An earlier
    # version read a key that does not exist, so the target always
    # showed as dashes.
    if parsed.get("hcalory_set_value_none"):
        target = None
    elif mode == 2:  # temperature
        target = parsed.get("set_temp")
    else:
        target = parsed.get("set_level")

    status = parsed.get("hcalory_status")

    shaped = {
        # hcalory_status: 0x0 off, 0x4 turning off, 0x8 heating,
        # 0xC ventilation, 0xF error. NOT running_state, which is only
        # ever 0 or 1 - reporting that was why the screen once said
        # "State 1".
        "state": status,
        "on": bool(parsed.get("running_state")),
        "running_step": step,
        "mode": mode,
        "target": target,
        "auto_start_stop": bool(parsed.get("auto_start_stop")),
        "voltage": parsed.get("supply_voltage"),
        "body_temperature_c": parsed.get("case_temperature"),
        "cabin_temperature_c": parsed.get("cab_temperature"),
        "error_code": parsed.get("error_code"),
        "igniting": step == STEP_IGNITION,
        "cooling_down": step == STEP_COOLDOWN,
        "ventilating": step == STEP_VENTILATION or status == STATUS_VENTILATION,
    }

    # Estimated, not measured - see fuel_rate_lph(). Carried in the
    # payload so history can integrate it without re-deriving the rule.
    shaped["fuel_lph"] = fuel_rate_lph(shaped)
    shaped["fuel_estimated"] = shaped["fuel_lph"] is not None

    return shaped


class Heater:
    def __init__(self) -> None:
        self.state: dict = {}
        self.connected = False
        self.error: str | None = None
        self.updated_at: float = 0.0
        self._client = None
        self._protocol = None
        self._replies: asyncio.Queue = asyncio.Queue()
        self._lock = asyncio.Lock()
        self.loop: asyncio.AbstractEventLoop | None = None
        # Counted so /state can report how flaky the link actually is,
        # rather than leaving it to be guessed from the journal.
        self._attempts = 0
        self._last_failure: str | None = None
        self.connects = 0

    # ------------------------------------------------------- commands

    async def power(self, on: bool) -> dict:
        step = self.state.get("running_step")

        # The guards live here, in the only process that can actually
        # talk to the heater, so they hold no matter what calls in.
        if not on and step == STEP_IGNITION:
            raise Busy(
                "The heater is igniting. Stopping now would leave unburnt fuel in the "
                "burner. Wait until it is running, then stop it."
            )
        if on and step == STEP_COOLDOWN:
            raise Busy(
                "The heater is cooling down and must finish its purge before it will start."
            )

        return await self._command(CMD_POWER, 1 if on else 0)

    async def temperature(self, celsius: int) -> dict:
        if not 0 <= celsius <= 40:
            raise BadValue("Target temperature must be between 0 and 40 C")
        return await self._command(CMD_SET_TEMPERATURE, celsius)

    async def level(self, value: int) -> dict:
        if not 1 <= value <= 10:
            raise BadValue("Level must be between 1 and 10")
        return await self._command(CMD_SET_LEVEL, value)

    async def mode(self, name: str) -> dict:
        if name not in ("level", "temperature"):
            raise BadValue("Mode must be 'level' or 'temperature'")
        return await self._command(CMD_SET_MODE, 2 if name == "temperature" else 1)

    async def ventilate(self) -> dict:
        """Fan-only, no burn. Useful for clearing fumes or shifting warm
        air without lighting the heater.

        The library's own note: ventilation only works from standby. So
        this refuses while the heater is running rather than sending a
        command the heater will silently ignore - a button that appears
        to do nothing is worse than one that says why.
        """
        state = self.state.get("state")

        if state not in (None, STATUS_OFF):
            raise Busy(
                "Ventilation only works from standby. Stop the heater first, let it "
                "finish its cool-down, then start ventilation."
            )

        self._require_connection()
        return await self._write(self._protocol.set_ventilation_mode())

    async def auto_start_stop(self) -> dict:
        self._require_connection()
        return await self._write(self._protocol.toggle_auto_start_stop())

    async def _command(self, command: int, argument: int) -> dict:
        self._require_connection()
        return await self._write(self._protocol.build_command(command, argument, PIN))

    def _require_connection(self) -> None:
        if not (self._client and self._client.is_connected and self._protocol):
            raise Unavailable("Not connected to the heater.")

    async def _write(self, raw) -> dict:
        """Send a command and return. Deliberately does NOT read back.

        The first version wrote, slept 1.5s, then queried and waited up
        to 12s for a reply - and after a set-temperature the heater is
        slow to answer, so every button press locked the UI for ~16s.

        The poll loop runs every second regardless. The new state shows
        up on its own within a second or two; blocking the caller on a
        readback bought nothing but latency. What is returned here is
        the last known state, which the UI already displays
        optimistically anyway.
        """
        async with self._lock:
            await self._client.write_gatt_char(MVP2_WRITE, raw, response=False)
        return self.state

    # ------------------------------------------------------ connection

    async def run(self) -> None:
        backoff = 5.0

        while True:
            try:
                await self._connect_and_poll()
                backoff = 5.0
            except Exception as e:  # noqa: BLE001 - BLE fails routinely
                self.connected = False
                self.error = str(e)
                self._client = None
                self._attempts += 1
                self._last_failure = str(e)

                # Logged at info for the first few, then debug: an
                # intermittent radio produces a lot of these and burying
                # the journal makes the real events harder to find.
                # Every tenth is logged regardless so a permanently
                # broken link is still visible.
                if self._attempts <= 3 or self._attempts % 10 == 0:
                    logger.warning(
                        "Link lost (%s). Attempt %d, retry in %.0fs", e, self._attempts, backoff
                    )
                else:
                    logger.debug("Link lost (%s). Retry in %.0fs", e, backoff)

                await asyncio.sleep(backoff)
                backoff = min(backoff * 1.5, MAX_BACKOFF)

    async def _connect_and_poll(self) -> None:
        from bleak_retry_connector import (
            BleakClientWithServiceCache,
            establish_connection,
        )
        from bleak_retry_connector.bluez import get_device_by_adapter
        from diesel_heater_ble.protocol import ProtocolHcalory

        protocol = ProtocolHcalory()
        protocol.set_mvp_version(True)

        # bleak_retry_connector, not raw bleak. This is the difference
        # between the projects that work and our first attempt.
        #
        # Our failure was always the same: "failed to discover services,
        # device disconnected", succeeding maybe one attempt in three.
        # BlueZ caches a device's GATT services on disk, and when that
        # cache goes stale, discovery fails against it repeatedly. Raw
        # bleak has no idea; it just reports a disconnect. This library
        # catches exactly that case, calls clear_cache(), waits, and
        # retries.
        #
        # It also classifies BlueZ's transient errors and backs off per
        # error type rather than uniformly.
        #
        # SERVICE CACHING IS OFF, deliberately. It was tried and made
        # things worse: skipping discovery meant BlueZ handed back a
        # cached characteristic it could no longer resolve, and
        # start_notify failed with
        #   [org.freedesktop.DBus.Error.UnknownObject] Method
        #   "StartNotify" ... doesn't exist
        # A slow rediscovery that works beats a fast one that hands back
        # a stale handle.
        #
        # get_device() reads BlueZ's D-Bus properties directly rather
        # than starting a discovery scan. That matters: the backend
        # container keeps a scan running for the Victron devices, and
        # BlueZ allows only one discovery session per adapter. Scanning
        # here would collide with it - which is the whole reason this
        # agent lives outside the container.
        # Clear anything BlueZ is still holding from a previous attempt
        # BEFORE connecting. establish_connection retries internally, so
        # a client left up by an earlier attempt produced "Client is
        # already connected" and burned all four retries without ever
        # reaching the heater. Cleaning up only in `finally` was too
        # late.
        await self._force_disconnect()

        # Scoped to our own adapter. get_device() searches every
        # adapter, which would happily hand back the device as seen by
        # hci0 - putting us straight back on the radio the Victron scan
        # owns, and undoing the whole point of the dongle.
        device = await get_device_by_adapter(MAC, ADAPTER)

        if device is None:
            raise RuntimeError(
                f"{MAC} is not known to BlueZ on {ADAPTER}. It may be powered down, "
                f"out of range, already connected to the phone app, or {ADAPTER} may "
                "not exist - check `hciconfig -a`."
            )

        # max_attempts=1, deliberately.
        #
        # establish_connection creates its BleakClient ONCE, outside its
        # own retry loop. So if attempt 1 connects and then fails during
        # service discovery, attempts 2-4 reuse the same already-
        # connected client and each raises "Client is already
        # connected" - and THAT is the error reported, masking the real
        # one entirely.
        #
        # This sent two separate debugging sessions after the wrong
        # thing. With max_attempts=1 the true failure surfaces
        # ("failed to discover services, device disconnected", which is
        # the heater dropping us), and our own retry loop above handles
        # backoff anyway - we were paying for its retries twice over.
        client = await establish_connection(
            BleakClientWithServiceCache,
            device,
            "hcalory-heater",
            max_attempts=1,
            # See the note above - caching services broke start_notify.
            use_services_cache=False,
            # Pinned again here: establish_connection creates its own
            # client, and without this bleak would fall back to the
            # default adapter.
            adapter=ADAPTER,
        )

        try:
            self._client = client
            self._protocol = protocol

            await client.start_notify(MVP2_NOTIFY, self._on_notify)

            # Handshake first. Without it the heater drops the link, and
            # bleak reports it as "failed to discover services" - which
            # looks like a Bluetooth fault rather than a protocol one.
            async with self._lock:
                await client.write_gatt_char(
                    MVP2_WRITE, protocol.build_password_handshake(PIN), response=False
                )
                protocol.mark_password_sent()
                await self._drain(5.0)

                # Time sync, ONCE, on connect - the working Home Assistant
                # integration does exactly this. The 0A0A packet the
                # library builds for a "status query" on MVP2 is in fact
                # the time-sync command; it carries HH:MM:SS and the
                # heater sets its clock from it. That is fine once. Sent
                # every second as a poll it is the thing that was making
                # the heater hang up on us after a few seconds - see
                # _query() below.
                await client.write_gatt_char(
                    MVP2_WRITE, protocol.build_command(CMD_STATUS, 0, PIN), response=False
                )
                await self._drain(3.0)

            self.connected = True
            self.error = None
            self.connects += 1
            logger.info(
                "Connected to heater %s (connection #%d after %d failed attempts)",
                MAC, self.connects, self._attempts,
            )
            self._attempts = 0

            while True:
                if not client.is_connected:
                    raise RuntimeError("Heater disconnected")
                async with self._lock:
                    await self._query()
                await asyncio.sleep(POLL_SECONDS)
        finally:
            # establish_connection returns a live client rather than a
            # context manager, so the disconnect is ours to do - and it
            # must happen even when the poll loop raises, or BlueZ is
            # left holding a half-open connection that makes the next
            # attempt worse.
            try:
                await client.disconnect()
            except Exception as e:  # noqa: BLE001 - best-effort cleanup
                logger.debug("Error disconnecting (ignored): %s", e)

    async def _query(self) -> dict:
        while not self._replies.empty():
            self._replies.get_nowait()

        # THE PLAIN STATUS QUERY, NOT THE LIBRARY'S DEFAULT.
        #
        # diesel-heater-ble 0.3.3's build_command(1) on MVP2 returns the
        # 0A0A time-sync packet. Polling with that every second means
        # telling the heater to set its clock every second, and the
        # heater responds by terminating the connection (HCI reason
        # 0x13, Remote User Terminated) after a few seconds. That was the
        # entire "drops after 6-19s" mystery.
        #
        # The working Home Assistant integration moved to the plain
        # 0E04 query for exactly this reason ("prefer_mvp1_query ...
        # Acropolis9064 proves it works"). Its payload ends in 000d -
        # which is byte-for-byte the "pump data" command in the very
        # first Hcalory library read for this project. The service
        # characteristics changed between MVP1 and MVP2; the status
        # query did not.
        await self._client.write_gatt_char(MVP2_WRITE, self._plain_query(), response=False)

        reply = await self._drain(REPLY_TIMEOUT)

        if reply is None:
            # A missed reply is not a disconnect. Keep the last known
            # state; the next poll tries again.
            return self.state

        parsed = self._protocol.parse(bytearray(reply))

        if not parsed:
            return self.state

        self.state = shape_state(parsed)
        self.updated_at = time.time()
        return self.state

    async def _force_disconnect(self) -> None:
        """Drop any lingering client and ask BlueZ to let go of the
        device. Best-effort throughout: every failure here is something
        that was already broken, and raising would only mask the real
        error from the connect that follows."""
        if self._client is not None:
            try:
                await self._client.disconnect()
            except Exception as e:  # noqa: BLE001
                logger.debug("Stale client would not disconnect (ignored): %s", e)
            self._client = None

        try:
            from bleak_retry_connector import close_stale_connections_by_address

            await close_stale_connections_by_address(MAC)
        except Exception as e:  # noqa: BLE001 - older versions may not have it
            logger.warning("close_stale_connections failed: %s", e)

    def _plain_query(self) -> bytearray:
        """The 0E04 status request. Built directly rather than via
        build_command(), which on MVP2 would hand back the time-sync
        packet instead."""
        from diesel_heater_ble.const import HCALORY_CMD_POWER, HCALORY_POWER_QUERY

        return self._protocol._build_hcalory_cmd(
            HCALORY_CMD_POWER, bytes([0, 0, 0, 0, 0, 0, 0, 0, HCALORY_POWER_QUERY])
        )

    async def _drain(self, timeout: float):
        try:
            return await asyncio.wait_for(self._replies.get(), timeout=timeout)
        except asyncio.TimeoutError:
            return None

    async def _on_notify(self, _char, data: bytearray) -> None:
        await self._replies.put(bytes(data))


class Busy(Exception): ...
class Unavailable(Exception): ...
class BadValue(Exception): ...


heater = Heater()


class Handler(BaseHTTPRequestHandler):
    """Minimal local HTTP. Bound to 127.0.0.1 only - this speaks for a
    combustion device and has no auth of its own; the VanOS backend in
    front of it is what enforces that."""

    def log_message(self, *args) -> None:  # quieter journal
        pass

    def _send(self, code: int, body: dict) -> None:
        payload = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _call(self, coro):
        """Bridges this thread onto the BLE event loop."""
        if heater.loop is None:
            self._send(503, {"detail": "Agent still starting."})
            return
        future = asyncio.run_coroutine_threadsafe(coro, heater.loop)
        try:
            self._send(200, future.result(timeout=40))
        except Busy as e:
            # 409, not 500: "not now" is a normal answer during
            # ignition and cooldown, not a fault.
            self._send(409, {"detail": str(e)})
        except Unavailable as e:
            self._send(503, {"detail": str(e)})
        except BadValue as e:
            self._send(400, {"detail": str(e)})
        except Exception as e:  # noqa: BLE001
            self._send(500, {"detail": str(e)})

    def do_GET(self) -> None:
        if self.path != "/state":
            self._send(404, {"detail": "Not found"})
            return
        self._send(200, {
            "connected": heater.connected,
            "error": heater.error,
            "updated_at": heater.updated_at,
            # Surfaced so link quality is visible without reading the
            # journal - this heater is genuinely intermittent and that
            # is worth being able to see.
            "connects": heater.connects,
            "failed_attempts": heater._attempts,
            "state": heater.state,
        })

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            self._send(400, {"detail": "Invalid JSON"})
            return

        routes = {
            "/power": lambda: heater.power(bool(body.get("on"))),
            "/temperature": lambda: heater.temperature(int(body.get("celsius", 0))),
            "/level": lambda: heater.level(int(body.get("level", 0))),
            "/mode": lambda: heater.mode(str(body.get("mode", ""))),
            "/auto-start-stop": lambda: heater.auto_start_stop(),
            "/ventilate": lambda: heater.ventilate(),
        }

        handler = routes.get(self.path)

        if handler is None:
            self._send(404, {"detail": "Not found"})
            return

        self._call(handler())


def main() -> None:
    loop = asyncio.new_event_loop()
    heater.loop = loop

    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    logger.info("Heater agent listening on 127.0.0.1:%d, heater %s", PORT, MAC)

    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(heater.run())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
