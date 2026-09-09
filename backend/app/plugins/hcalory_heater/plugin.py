"""
Hcalory diesel air heater plugin (Bluetooth LE, MVP2).

Reads the heater's live state and sends commands to it: the same
figures and controls the Hcalory phone app shows - case temperature,
cabin temperature, supply voltage, run state, mode, target, and
auto start/stop.

WHY MVP2 SPECIFICALLY
There are two incompatible Hcalory variants. The first version of this
plugin implemented MVP1 (service FFF0), taken from a project written
against a W1, and it was simply wrong for this van. The probe settled
it: this heater advertises as "Heater5579" on service BD39 - MVP2,
with different characteristics AND a different frame layout.

    MVP1  service FFF0, write FFF2, notify FFF1
    MVP2  service BD39, write BDF7, notify BDF8

MVP2 also requires a PASSWORD HANDSHAKE immediately after connecting.
Without it the heater drops the link, which surfaces as bleak's
unhelpful "failed to discover services, device disconnected" and looks
like a Bluetooth fault rather than a protocol one. That cost an
evening. This van's PIN is 0000.

PROTOCOL
`diesel-heater-ble` (MIT) builds and parses the packets. It covers six
protocol variants and has 213 tests behind it, which is a great deal
more than anything derivable from one van. It is protocol-only and
deliberately leaves the BLE transport to the caller, so the connection
handling below is ours.

WHY IT HOLDS A CONNECTION RATHER THAN LISTENING
The Victron devices broadcast; those plugins share one passive scanner
and never connect (see ble_scanner.py). This heater says nothing unless
asked: connect, subscribe, then write a query before it answers. So
this holds a connection and polls.

Consequence worth knowing: only ONE thing can be connected at a time.
While VanOS holds the link the phone app cannot, and vice versa. That
is the heater's behaviour, not a bug here, and it is the first thing to
check when either stops working.

SAFETY - the part that matters
This is a combustion device and the app is reachable from outside the
van over the Cloudflare tunnel. Two guards, enforced here rather than
left to the UI to remember:

  * A stop is REFUSED while the heater is igniting. Interrupting
    ignition leaves unburnt fuel in the burner and exhaust. On this van
    that fouled the previous heater badly enough that its replacement
    had to burn through the residue before it would light.

  * A start is REFUSED during cooldown. The heater is purging and will
    not honour it anyway; queuing one risks an immediate restart into a
    hot chamber.

Both are checked against the heater's own reported running_step, not
against what we think we last commanded - those two diverge exactly
when it matters.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from app.plugins.base import Plugin, PluginStatus
from app.plugins.ble_scanner import shared_ble_scanner
from app.telemetry.bus import TelemetryBus
from app.telemetry.models import TelemetryDomain, TelemetryMessage, TelemetrySource

logger = logging.getLogger("vanos.plugins.hcalory_heater")

MVP2_WRITE = "0000bdf7-0000-1000-8000-00805f9b34fb"
MVP2_NOTIFY = "0000bdf8-0000-1000-8000-00805f9b34fb"

DEFAULT_POLL_SECONDS = 10.0
DEFAULT_PIN = 0
CONNECT_TIMEOUT = 45.0
REPLY_TIMEOUT = 12.0
MAX_BACKOFF_SECONDS = 120.0

# Vevor-style command numbers the library maps onto Hcalory packets.
CMD_STATUS = 1
CMD_SET_MODE = 2
CMD_POWER = 3
CMD_SET_TEMPERATURE = 4
CMD_SET_LEVEL = 5

# running_step values, from the library's constants.
STEP_IGNITION = 0x3
STEP_COOLDOWN = 0x4


class HeaterBusy(RuntimeError):
    """A command was refused because the heater is mid-ignition or
    mid-cooldown. Its own type so the API can answer 409 rather than a
    generic failure: "not now" is a different answer from "broken"."""


class HeaterUnavailable(RuntimeError):
    """No connection to the heater."""


class HcaloryHeaterPlugin(Plugin):
    name = "hcalory_heater"
    display_name = "Diesel Heater"
    version = "0.2.0"

    def __init__(self, bus: TelemetryBus) -> None:
        super().__init__(bus)
        self._task: asyncio.Task | None = None
        self._mac: str = ""
        self._pin: int = DEFAULT_PIN
        self._poll_seconds: float = DEFAULT_POLL_SECONDS
        self._client: Any = None
        self._protocol: Any = None
        self._replies: asyncio.Queue[bytes] = asyncio.Queue()
        self._latest: dict[str, Any] = {}
        # Serialises commands against the poll loop. Two writes racing on
        # one characteristic is how these controllers get confused.
        self._lock = asyncio.Lock()

    def configure(self, config: dict[str, Any]) -> None:
        super().configure(config)
        self._mac = str(config.get("mac") or "").strip()
        try:
            self._pin = int(config.get("pin", DEFAULT_PIN))
        except (TypeError, ValueError):
            self._pin = DEFAULT_PIN
        try:
            self._poll_seconds = max(5.0, float(config.get("poll_seconds", DEFAULT_POLL_SECONDS)))
        except (TypeError, ValueError):
            self._poll_seconds = DEFAULT_POLL_SECONDS

    async def start(self) -> None:
        if not self._mac:
            self.status = PluginStatus.ERROR
            self.last_error = (
                "No heater MAC configured. Find it with "
                "`python3 tools/heater_probe.py`, then set hcalory_heater.mac."
            )
            logger.warning(self.last_error)
            return

        self.status = PluginStatus.STARTING
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        self._client = None
        self.status = PluginStatus.STOPPED

    # ------------------------------------------------------------ state

    @property
    def latest(self) -> dict[str, Any]:
        return dict(self._latest)

    @property
    def connected(self) -> bool:
        return bool(self._client and self._client.is_connected)

    # ---------------------------------------------------------- control

    async def set_power(self, on: bool) -> dict[str, Any]:
        step = self._latest.get("running_step")

        if not on and step == STEP_IGNITION:
            raise HeaterBusy(
                "The heater is igniting. Stopping now would leave unburnt fuel in the "
                "burner. Wait until it is running, then stop it."
            )

        if on and step == STEP_COOLDOWN:
            raise HeaterBusy(
                "The heater is cooling down and must finish its purge. It will accept "
                "a start once that completes."
            )

        return await self._command(CMD_POWER, 1 if on else 0)

    async def set_target_temperature(self, celsius: int) -> dict[str, Any]:
        # The library's documented range for this protocol.
        if not 0 <= celsius <= 40:
            raise ValueError("Target temperature must be between 0 and 40 C")
        return await self._command(CMD_SET_TEMPERATURE, celsius)

    async def set_level(self, level: int) -> dict[str, Any]:
        if not 1 <= level <= 10:
            raise ValueError("Level must be between 1 and 10")
        return await self._command(CMD_SET_LEVEL, level)

    async def set_mode(self, mode: str) -> dict[str, Any]:
        if mode not in ("level", "temperature"):
            raise ValueError("Mode must be 'level' or 'temperature'")
        return await self._command(CMD_SET_MODE, 2 if mode == "temperature" else 1)

    async def toggle_auto_start_stop(self) -> dict[str, Any]:
        # The protocol offers a toggle only - there is no way to command
        # it to a specific state, so the UI must read back rather than
        # assume it landed where it wanted.
        if not self.connected or self._protocol is None:
            raise HeaterUnavailable("Not connected to the heater.")
        return await self._write_and_refresh(self._protocol.toggle_auto_start_stop())

    async def _command(self, command: int, argument: int) -> dict[str, Any]:
        if not self.connected or self._protocol is None:
            raise HeaterUnavailable("Not connected to the heater.")
        return await self._write_and_refresh(self._protocol.build_command(command, argument, self._pin))

    async def _write_and_refresh(self, raw: bytearray) -> dict[str, Any]:
        async with self._lock:
            await self._client.write_gatt_char(MVP2_WRITE, raw, response=False)
            # The heater takes a moment to act. Querying immediately
            # returns the old state, which would make the UI look like
            # the command was ignored.
            await asyncio.sleep(1.5)
            return await self._query_locked()

    # -------------------------------------------------------- transport

    async def _run(self) -> None:
        backoff = 5.0

        while True:
            try:
                await self._connect_and_poll()
                backoff = 5.0
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001 - BLE fails routinely here; that is normal
                self._client = None
                self.status = PluginStatus.ERROR
                self.last_error = str(e)
                logger.warning("Heater link lost (%s). Retry in %.0fs", e, backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, MAX_BACKOFF_SECONDS)

    async def _connect_and_poll(self) -> None:
        from bleak import BleakClient
        from diesel_heater_ble.protocol import ProtocolHcalory

        protocol = ProtocolHcalory()
        protocol.set_mvp_version(True)

        # BlueZ permits ONE active discovery session per adapter, and
        # the Victron plugins keep the shared scan running continuously
        # (see ble_scanner.py). Connecting into that collides, and once
        # it has, BlueZ stays wedged: every retry then fails with
        # "[org.bluez.Error.InProgress] Operation already in progress"
        # rather than recovering.
        #
        # So the scan is stopped for the duration of the connect, then
        # restored. Holding a GATT connection alongside a scan is fine -
        # it is only the connect itself that conflicts - so the Victron
        # plugins lose a couple of seconds of advertisements per
        # reconnect and nothing more. Their own staleness supervisors
        # tolerate far longer gaps than that.
        await shared_ble_scanner.restart()
        await asyncio.sleep(1.0)  # let BlueZ settle before connecting

        try:
            client_cm = BleakClient(self._mac, timeout=CONNECT_TIMEOUT)
            client = await client_cm.__aenter__()
        finally:
            # Restored whether or not the connect worked. A failed
            # connect must not leave the Victron plugins deaf.
            await shared_ble_scanner.ensure_running()

        async with _Closing(client_cm):
            self._client = client
            self._protocol = protocol

            await client.start_notify(MVP2_NOTIFY, self._on_notify)

            # Handshake first. Everything else is ignored until it lands,
            # and the heater drops the link if it never comes.
            async with self._lock:
                await client.write_gatt_char(
                    MVP2_WRITE, protocol.build_password_handshake(self._pin), response=False
                )
                protocol.mark_password_sent()
                await self._drain_one(timeout=5.0)

            self.status = PluginStatus.RUNNING
            self.last_error = None
            logger.info("Connected to heater %s", self._mac)

            while True:
                if not client.is_connected:
                    raise RuntimeError("Heater disconnected")

                async with self._lock:
                    await self._query_locked()

                await asyncio.sleep(self._poll_seconds)

    async def _query_locked(self) -> dict[str, Any]:
        """Send a status query and publish the reply.

        Caller holds the lock: a write and the notification it provokes
        must not interleave with another command's, or the wrong reply
        gets read as the answer.
        """
        while not self._replies.empty():
            self._replies.get_nowait()

        raw = self._protocol.build_command(CMD_STATUS, 0, self._pin)
        await self._client.write_gatt_char(MVP2_WRITE, raw, response=False)

        reply = await self._drain_one(timeout=REPLY_TIMEOUT)

        if reply is None:
            # A missed reply is not a disconnect. Keep the last known
            # state and let the next poll try again.
            logger.debug("No reply from heater this cycle")
            return self._latest

        parsed = self._protocol.parse(bytearray(reply))

        if not parsed:
            logger.debug("Unparseable frame (%d bytes)", len(reply))
            return self._latest

        payload = self._shape(parsed)
        self._latest = payload
        self.last_heartbeat = time.time()

        await self.bus.publish(
            TelemetryMessage(
                domain=TelemetryDomain.HEATING,
                source=TelemetrySource.HCALORY_HEATER,
                timestamp=time.time(),
                payload=payload,
            )
        )

        return payload

    async def _drain_one(self, timeout: float) -> bytes | None:
        try:
            return await asyncio.wait_for(self._replies.get(), timeout=timeout)
        except asyncio.TimeoutError:
            return None

    async def _on_notify(self, _char, data: bytearray) -> None:
        await self._replies.put(bytes(data))

    # ---------------------------------------------------------- shaping

    @staticmethod
    def _shape(parsed: dict[str, Any]) -> dict[str, Any]:
        """Map the library's fields onto the names VanOS uses.

        An explicit mapping rather than passing the raw dict through, so
        an upstream rename shows up here as a missing key instead of
        silently emptying a card in the UI.
        """
        step = parsed.get("running_step")

        return {
            "connected": True,
            "state": parsed.get("running_state"),
            "running_step": step,
            "mode": parsed.get("running_mode"),
            "target": None if parsed.get("hcalory_set_value_none") else parsed.get("hcalory_set_value"),
            "auto_start_stop": bool(parsed.get("auto_start_stop")),
            "voltage": parsed.get("supply_voltage"),
            "body_temperature_c": parsed.get("case_temperature"),
            "cabin_temperature_c": parsed.get("cab_temperature"),
            "error_code": parsed.get("error_code"),
            # Surfaced so the UI can disable controls the heater will
            # refuse anyway, rather than letting someone press them and
            # watch nothing happen.
            "igniting": step == STEP_IGNITION,
            "cooling_down": step == STEP_COOLDOWN,
        }


class _Closing:
    """Closes a BleakClient context that was entered manually.

    The connect has to happen with the shared BLE scan stopped, and the
    scan has to come back whether or not it succeeded - which means
    entering the client outside `async with`. This puts the exit back.
    """

    def __init__(self, cm) -> None:
        self._cm = cm

    async def __aenter__(self):
        return self._cm

    async def __aexit__(self, exc_type, exc, tb):
        try:
            await self._cm.__aexit__(exc_type, exc, tb)
        except Exception as e:  # noqa: BLE001 - best-effort cleanup
            logger.debug("Error closing heater connection (ignored): %s", e)
        return False
