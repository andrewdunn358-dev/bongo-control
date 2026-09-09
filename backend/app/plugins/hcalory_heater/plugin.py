"""
Hcalory diesel air heater plugin (Bluetooth LE).

Reads the heater's live state - body temperature, cabin temperature,
supply voltage, run state, mode and power setting - and publishes it to
the HEATING domain.

WHY THIS IS SHAPED DIFFERENTLY FROM THE VICTRON PLUGINS
The Victron devices broadcast. They advertise their readings to anyone
listening, so those plugins share one passive scanner and never connect
to anything (see ble_scanner.py).

This heater does the opposite, and awkwardly: it tells you nothing
unless you ask. You must open a GATT connection, subscribe to
notifications on the read characteristic, and then WRITE a "pump data"
command to the write characteristic before it will send anything back.
The official phone app does this once per second. So this plugin holds a
connection rather than listening, and polls on a timer.

That has two consequences worth knowing:

  1. Only ONE thing can be connected at a time. While VanOS holds the
     connection, the Hcalory phone app cannot connect, and vice versa.
     This is a property of the heater, not a bug here - but it is the
     first thing to check when either one stops working.

  2. An active GATT connection alongside BlueZ's discovery scan (which
     the Victron plugins keep running) is less reliable on a Pi than
     either alone. Hence the retry/backoff loop rather than assuming a
     connection stays up.

PROTOCOL CREDIT
The frame format, characteristic UUIDs and command bytes come from
evanfoster/hcalory-control (LGPL-3.0) and mSoftMS/AirHeater-BLE (MIT),
both of which reverse-engineered the official app. Reimplemented here
against the documented protocol rather than taken as a dependency: the
upstream library pulls in `datastruct` to parse one 39-byte frame, and
adding a dependency to a Pi 2B for that is a poor trade when `struct`
is in the standard library.

ONE DELIBERATE DIFFERENCE from upstream: it reports voltage and
temperatures with integer division, so 12.4 V arrives as 12 and 150.7 C
as 150. The raw values are tenths and the phone app displays the
decimal, so this keeps the tenth. Throwing away a known digit is the
kind of quiet precision loss this project avoids elsewhere.

WHAT IT DOES NOT DO
Control. This reads only. Turning a combustion heater on or off from a
web UI - potentially from outside the van, over the tunnel - is a
different kind of decision from switching a light, and it deserves its
own thought about interlocks rather than arriving as a side effect of
adding a sensor. The protocol supports it and the commands are listed
below unused, deliberately.
"""

from __future__ import annotations

import asyncio
import logging
import struct
import time
from typing import Any

from app.plugins.base import Plugin, PluginStatus
from app.telemetry.bus import TelemetryBus
from app.telemetry.models import TelemetryDomain, TelemetryMessage, TelemetrySource

logger = logging.getLogger("vanos.plugins.hcalory_heater")

WRITE_CHARACTERISTIC = "0000fff2-0000-1000-8000-00805f9b34fb"
READ_CHARACTERISTIC = "0000fff1-0000-1000-8000-00805f9b34fb"

# Every command is this header plus a two-byte opcode.
COMMAND_HEADER = bytes.fromhex("000200010001000e040000090000000000000000")
CMD_PUMP_DATA = COMMAND_HEADER + bytes.fromhex("000d")

# Present and unused on purpose - see "WHAT IT DOES NOT DO" above.
CMD_START_HEAT = COMMAND_HEADER + bytes.fromhex("020f")
CMD_STOP_HEAT = COMMAND_HEADER + bytes.fromhex("010e")

DEFAULT_POLL_SECONDS = 15.0
CONNECT_TIMEOUT = 30.0
RESPONSE_TIMEOUT = 10.0
MAX_BACKOFF_SECONDS = 120.0
# A response shorter than this cannot contain the fields we read.
MIN_FRAME_LENGTH = 32

HEATER_STATES = {
    0: "off",
    65: "cooldown",
    67: "cooldown_starting",
    69: "cooldown_received",
    128: "ignition_received",
    129: "ignition_starting",
    131: "igniting",
    133: "running",
    135: "heating",
    255: "error",
}

HEATER_MODES = {0: "off", 1: "thermostat", 2: "gear", 8: "ignition_failed"}

# States during which the heater must not be interrupted - it is either
# establishing a flame or purging one. Cutting power here is what leaves
# unburnt fuel in the exhaust, which on this van fouled a heater badly
# enough to need replacing.
UNINTERRUPTIBLE = {65, 67, 69, 128, 129, 131, 135}


def parse_frame(data: bytes) -> dict[str, Any] | None:
    """Decode one status frame.

    Layout, from the reverse-engineered protocol:
        [0:20]  header
        [20]    state
        [21]    mode
        [22]    setting
        [23]    unknown
        [24]    padding
        [25]    voltage, tenths
        [26]    padding
        [27:29] body temperature, tenths, big-endian
        [29]    padding
        [30:32] ambient temperature, tenths, big-endian

    Returns None on anything too short to trust rather than raising:
    a truncated BLE notification is a routine event, not a fault, and it
    should cost one poll rather than the plugin.
    """
    if len(data) < MIN_FRAME_LENGTH:
        return None

    state_byte = data[20]
    mode_byte = data[21]
    setting = data[22]
    voltage_raw = data[25]
    body_raw = struct.unpack(">H", data[27:29])[0]
    ambient_raw = struct.unpack(">H", data[30:32])[0]

    return {
        # Unknown codes are reported as their raw number rather than
        # guessed at or hidden. A state we have never seen is more
        # useful shown as "unknown (137)" than silently mapped to
        # something plausible.
        "state": HEATER_STATES.get(state_byte, f"unknown ({state_byte})"),
        "mode": HEATER_MODES.get(mode_byte, f"unknown ({mode_byte})"),
        "setting": setting,
        "voltage": round(voltage_raw / 10.0, 1),
        "body_temperature_c": round(body_raw / 10.0, 1),
        "ambient_temperature_c": round(ambient_raw / 10.0, 1),
        "running": state_byte in {128, 129, 131, 133, 135},
        "uninterruptible": state_byte in UNINTERRUPTIBLE,
        "error": state_byte == 255 or mode_byte == 8,
    }


class HcaloryHeaterPlugin(Plugin):
    name = "hcalory_heater"
    display_name = "Diesel Heater"
    version = "0.1.0"

    def __init__(self, bus: TelemetryBus) -> None:
        super().__init__(bus)
        self._task: asyncio.Task | None = None
        self._mac: str = ""
        self._poll_seconds: float = DEFAULT_POLL_SECONDS
        self._queue: asyncio.Queue[bytearray] = asyncio.Queue()
        self._last_frame: bytes | None = None

    def configure(self, config: dict[str, Any]) -> None:
        super().configure(config)
        self._mac = str(config.get("mac") or "").strip()
        try:
            self._poll_seconds = max(5.0, float(config.get("poll_seconds", DEFAULT_POLL_SECONDS)))
        except (TypeError, ValueError):
            self._poll_seconds = DEFAULT_POLL_SECONDS

    async def start(self) -> None:
        if not self._mac:
            # No MAC means nothing to connect to. Reported as an error
            # with a usable instruction rather than sitting in "starting"
            # forever - finding this address is the awkward part of the
            # setup and the message should say how.
            self.status = PluginStatus.ERROR
            self.last_error = (
                "No heater MAC address configured. Scan for it with "
                "`bluetoothctl scan on` (the heater advertises as HCALORY, "
                "AirHeater or TY) with the phone app closed, then set it in config."
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
        self.status = PluginStatus.STOPPED

    async def _run(self) -> None:
        backoff = 5.0

        while True:
            try:
                await self._poll_forever()
                backoff = 5.0
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001 - the radio fails constantly; that is normal
                self.status = PluginStatus.ERROR
                self.last_error = str(e)
                logger.warning("Heater connection lost (%s). Retrying in %.0fs", e, backoff)
                await asyncio.sleep(backoff)
                # Backs off rather than hammering: the usual reason for a
                # failed connect is the phone app holding the heater, and
                # retrying every second neither helps nor ends sooner.
                backoff = min(backoff * 2, MAX_BACKOFF_SECONDS)

    async def _poll_forever(self) -> None:
        from bleak import BleakClient, BleakScanner

        device = await BleakScanner.find_device_by_address(self._mac, timeout=CONNECT_TIMEOUT)

        if device is None:
            raise RuntimeError(
                f"Heater {self._mac} not found. It may be powered down, out of range, "
                "or already connected to the phone app."
            )

        async with BleakClient(device, timeout=CONNECT_TIMEOUT) as client:
            await client.start_notify(READ_CHARACTERISTIC, self._on_notify)
            self.status = PluginStatus.RUNNING
            self.last_error = None
            logger.info("Connected to heater %s", self._mac)

            while True:
                if not client.is_connected:
                    raise RuntimeError("Heater disconnected")

                await self._poll_once(client)
                await asyncio.sleep(self._poll_seconds)

    async def _poll_once(self, client) -> None:
        # Drain anything queued from a previous cycle so a late reply
        # can't be read as the answer to this request.
        while not self._queue.empty():
            self._queue.get_nowait()

        await client.write_gatt_char(WRITE_CHARACTERISTIC, CMD_PUMP_DATA, response=False)

        try:
            raw = await asyncio.wait_for(self._queue.get(), timeout=RESPONSE_TIMEOUT)
        except asyncio.TimeoutError:
            # A missed reply is not a disconnect. Skip this cycle and let
            # the next poll try again; the connection is usually fine.
            logger.debug("No response from heater this cycle")
            return

        self._last_frame = bytes(raw)
        payload = parse_frame(self._last_frame)

        if payload is None:
            logger.debug("Short frame from heater (%d bytes), ignoring", len(raw))
            return

        # The raw frame is carried so a diagnostics view can show it.
        # Two of the bytes in this protocol are still unidentified, and
        # this van will be the thing that identifies them.
        payload["raw"] = self._last_frame.hex()

        self.last_heartbeat = time.time()

        await self.bus.publish(
            TelemetryMessage(
                domain=TelemetryDomain.HEATING,
                source=TelemetrySource.HCALORY_HEATER,
                timestamp=time.time(),
                payload=payload,
            )
        )

    async def _on_notify(self, _characteristic, data: bytearray) -> None:
        await self._queue.put(data)
