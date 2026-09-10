#!/usr/bin/env python3
"""
VanOS heater agent — runs on the Pi HOST, not in the container.

Owns the Bluetooth link to the Hcalory heater and exposes it over plain
HTTP on 127.0.0.1, so the VanOS backend never touches Bluetooth for the
heater at all.

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
STEP_IGNITION, STEP_COOLDOWN = 0x3, 0x4


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
        async with self._lock:
            await self._client.write_gatt_char(MVP2_WRITE, raw, response=False)
            # The heater takes a moment to act; querying immediately
            # returns the old state and looks like nothing happened.
            await asyncio.sleep(1.5)
            return await self._query()

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
            get_device,
        )
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

        device = await get_device(MAC)

        if device is None:
            raise RuntimeError(
                f"{MAC} is not known to BlueZ. It may be powered down, out of range, "
                "or already connected to the phone app."
            )

        client = await establish_connection(
            BleakClientWithServiceCache,
            device,
            "hcalory-heater",
            max_attempts=4,
            # See the note above - caching services broke start_notify.
            use_services_cache=False,
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

        await self._client.write_gatt_char(
            MVP2_WRITE, self._protocol.build_command(CMD_STATUS, 0, PIN), response=False
        )

        reply = await self._drain(REPLY_TIMEOUT)

        if reply is None:
            # A missed reply is not a disconnect. Keep the last known
            # state; the next poll tries again.
            return self.state

        parsed = self._protocol.parse(bytearray(reply))

        if not parsed:
            return self.state

        step = parsed.get("running_step")
        self.state = {
            "state": parsed.get("running_state"),
            "running_step": step,
            "mode": parsed.get("running_mode"),
            "target": None if parsed.get("hcalory_set_value_none") else parsed.get("hcalory_set_value"),
            "auto_start_stop": bool(parsed.get("auto_start_stop")),
            "voltage": parsed.get("supply_voltage"),
            "body_temperature_c": parsed.get("case_temperature"),
            "cabin_temperature_c": parsed.get("cab_temperature"),
            "error_code": parsed.get("error_code"),
            "igniting": step == STEP_IGNITION,
            "cooling_down": step == STEP_COOLDOWN,
        }
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
            logger.debug("close_stale_connections unavailable (ignored): %s", e)

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
