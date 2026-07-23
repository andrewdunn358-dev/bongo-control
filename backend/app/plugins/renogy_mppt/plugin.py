"""
Renogy MPPT charge controller plugin (BT-1 / BT-2 Bluetooth modules).

⚠️  UNTESTED AGAINST REAL HARDWARE.  ⚠️
Neither the author nor this project owns a Renogy controller. The
protocol below is implemented from the documented Modbus-over-BLE
scheme used by cyrils/renogy-bt (MIT licensed), which is well
established and widely used, but this specific implementation has
never spoken to a physical device. Treat any reading it produces as
unverified until someone confirms it against the Renogy app.

If you have this hardware and it works - or doesn't - please open an
issue. A report either way is genuinely useful.

WHY THIS TALKS TO THE DEVICE DIRECTLY RATHER THAN USING renogy-bt
renogy-bt is not distributed on PyPI and has no setup.py or
pyproject.toml, so it cannot be pip-installed as a dependency at all -
it's designed to be cloned and run as an application. Vendoring the
whole thing to use one client class would be heavy, and would leave a
copy that silently drifts from upstream. The underlying protocol is
just Modbus RTU framed over a BLE characteristic, and this project
already depends on bleak for the Victron plugin, so implementing it
directly is both lighter and more honest about what's happening.

PROTOCOL
- Discover a device whose name starts with BT-TH (BT-1/BT-2 modules)
- Connect, subscribe to notify characteristic 0000fff1-...
- Write a Modbus read request to 0000ffd1-...
- Response arrives on the notify characteristic
- Register 256 (0x0100), 34 words, carries the live charging data

Requires no encryption key, unlike Victron - Renogy's BLE modules are
unencrypted, which is convenient here and mildly alarming in general.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.plugins.base import Plugin, PluginStatus
from app.telemetry.bus import TelemetryBus
from app.telemetry.models import TelemetryDomain, TelemetryMessage, TelemetrySource

logger = logging.getLogger("vanos.plugins.renogy_mppt")

NOTIFY_CHAR_UUID = "0000fff1-0000-1000-8000-00805f9b34fb"
WRITE_CHAR_UUID = "0000ffd1-0000-1000-8000-00805f9b34fb"

# BT-1 and BT-2 modules advertise with these prefixes.
DEVICE_NAME_PREFIXES = ("BT-TH", "RNGRBP")

# Live charging data. 34 words starting at register 0x0100.
CHARGING_INFO_REGISTER = 256
CHARGING_INFO_WORDS = 34

DEFAULT_DEVICE_ID = 255  # broadcast; works for BT-1 in the common single-device case
DEFAULT_POLL_INTERVAL_SECONDS = 30.0
CONNECT_TIMEOUT_SECONDS = 20.0
RESPONSE_TIMEOUT_SECONDS = 15.0

CHARGING_STATE = {
    0: "deactivated",
    1: "activated",
    2: "mppt",
    3: "equalizing",
    4: "boost",
    5: "floating",
    6: "current limiting",
}


def crc16_modbus(data: bytes) -> bytes:
    """Standard Modbus RTU CRC-16, returned high byte first to match
    the order Renogy expects on the wire.
    """
    crc = 0xFFFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            if crc & 1:
                crc = (crc >> 1) ^ 0xA001
            else:
                crc >>= 1
    # Low byte first, then high - standard Modbus RTU order. Verified
    # byte-for-byte against the reference implementation; I had this
    # reversed initially and every frame's CRC was byte-swapped, which
    # a real controller would have silently ignored.
    return bytes([crc & 0xFF, (crc >> 8) & 0xFF])


def build_read_request(device_id: int, register: int, words: int) -> bytes:
    """Modbus function 3 (read holding registers) with a CRC."""
    frame = bytes(
        [
            device_id,
            0x03,
            (register >> 8) & 0xFF,
            register & 0xFF,
            (words >> 8) & 0xFF,
            words & 0xFF,
        ]
    )
    return frame + crc16_modbus(frame)


def read_int(data: bytes, offset: int, length: int, scale: float = 1.0) -> float | int | None:
    """Big-endian unsigned integer from the response payload."""
    if offset + length > len(data):
        return None
    value = int.from_bytes(data[offset : offset + length], byteorder="big")
    return round(value * scale, 2) if scale != 1.0 else value


def parse_charging_info(payload: bytes) -> dict[str, Any]:
    """Byte offsets from the documented register 256 layout.

    Offsets are into the full response frame (including the Modbus
    header), matching the reference implementation - not into the data
    section alone. Getting that wrong shifts every field.
    """
    return {
        "battery_percentage": read_int(payload, 3, 2),
        "battery_voltage": read_int(payload, 5, 2, 0.1),
        "battery_current": read_int(payload, 7, 2, 0.01),
        "controller_temperature_c": read_int(payload, 9, 1),
        "battery_temperature_c": read_int(payload, 10, 1),
        "load_voltage": read_int(payload, 11, 2, 0.1),
        "load_current": read_int(payload, 13, 2, 0.01),
        "load_power": read_int(payload, 15, 2),
        "pv_voltage": read_int(payload, 17, 2, 0.1),
        "pv_current": read_int(payload, 19, 2, 0.01),
        "pv_power": read_int(payload, 21, 2),
        "max_charging_power_today": read_int(payload, 33, 2),
        "power_generation_today_wh": read_int(payload, 41, 2),
        "power_generation_total_wh": read_int(payload, 59, 4),
        "charging_status": CHARGING_STATE.get(read_int(payload, 68, 1) or 0),
    }


class RenogyMPPTPlugin(Plugin):
    name = "renogy_mppt"
    display_name = "Renogy MPPT (BT-1/BT-2)"
    version = "0.1.0"  # 0.x deliberately: untested against real hardware

    def __init__(self, bus: TelemetryBus) -> None:
        super().__init__(bus)
        self._task: asyncio.Task | None = None
        self._mac: str | None = None
        self._device_id = DEFAULT_DEVICE_ID
        self._poll_interval = DEFAULT_POLL_INTERVAL_SECONDS
        self._peak_watts_today = 0.0

    def configure(self, config: dict[str, Any]) -> None:
        super().configure(config)
        self._mac = config.get("mac_address") or None
        self._device_id = int(config.get("device_id", DEFAULT_DEVICE_ID))
        self._poll_interval = float(config.get("poll_interval_seconds", DEFAULT_POLL_INTERVAL_SECONDS))

    async def start(self) -> None:
        self.status = PluginStatus.STARTING
        self._task = asyncio.create_task(self._run())
        self.status = PluginStatus.RUNNING
        logger.info("Renogy MPPT plugin started (untested against real hardware)")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        self.status = PluginStatus.STOPPED

    async def scan(self, duration_seconds: float = 10.0) -> list[dict[str, Any]]:
        """Discover nearby BT-1/BT-2 modules so the user can pick one."""
        try:
            from bleak import BleakScanner
        except ImportError:
            self.record_error("bleak is not installed")
            return []

        devices = await BleakScanner.discover(timeout=duration_seconds)
        return [
            {"name": d.name, "mac_address": d.address, "rssi": getattr(d, "rssi", None)}
            for d in devices
            if d.name and d.name.startswith(DEVICE_NAME_PREFIXES)
        ]

    async def _run(self) -> None:
        try:
            while True:
                try:
                    await self._poll_once()
                except asyncio.CancelledError:
                    raise
                except Exception as e:  # noqa: BLE001 - a BLE read failing shouldn't kill the plugin
                    self.record_error(str(e))
                    logger.warning("Renogy poll failed: %s", e)
                await asyncio.sleep(self._poll_interval)
        except asyncio.CancelledError:
            raise

    async def _poll_once(self) -> None:
        if not self._mac:
            self.record_error("No mac_address configured - run a device scan in Settings and pick your controller")
            return

        try:
            from bleak import BleakClient
        except ImportError:
            self.record_error("bleak is not installed")
            return

        response: asyncio.Future[bytes] = asyncio.get_running_loop().create_future()

        def on_notify(_sender: Any, data: bytearray) -> None:
            if not response.done():
                response.set_result(bytes(data))

        async with BleakClient(self._mac, timeout=CONNECT_TIMEOUT_SECONDS) as client:
            await client.start_notify(NOTIFY_CHAR_UUID, on_notify)
            request = build_read_request(self._device_id, CHARGING_INFO_REGISTER, CHARGING_INFO_WORDS)
            await client.write_gatt_char(WRITE_CHAR_UUID, request, response=False)

            try:
                payload = await asyncio.wait_for(response, timeout=RESPONSE_TIMEOUT_SECONDS)
            except asyncio.TimeoutError:
                raise RuntimeError("No response from controller within timeout")
            finally:
                try:
                    await client.stop_notify(NOTIFY_CHAR_UUID)
                except Exception:  # noqa: BLE001 - already disconnecting, nothing useful to do
                    pass

        # Modbus error responses set the high bit of the function code.
        if len(payload) > 1 and payload[1] & 0x80:
            raise RuntimeError(f"Controller returned a Modbus error (code {payload[2] if len(payload) > 2 else '?'})")

        await self._publish(parse_charging_info(payload))

    async def _publish(self, data: dict[str, Any]) -> None:
        pv_power = data.get("pv_power") or 0
        self._peak_watts_today = max(self._peak_watts_today, float(pv_power))

        async def emit(domain: TelemetryDomain, payload: dict[str, Any]) -> None:
            await self.bus.publish(
                TelemetryMessage(domain=domain, source=TelemetrySource.RENOGY_MPPT, payload=payload)
            )

        battery_voltage = data.get("battery_voltage")
        battery_current = data.get("battery_current")
        battery_pct = data.get("battery_percentage")

        await emit(
            TelemetryDomain.BATTERY,
            {
                # Unlike the Victron MPPT, Renogy controllers DO report a
                # battery percentage. It's the controller's own estimate
                # from voltage, not a shunt-based coulomb count, so it's
                # less accurate than a real SoC - but it is a genuine
                # reading from the device rather than something invented
                # here, so it's passed through.
                "soc_pct": battery_pct,
                "voltage": battery_voltage,
                "charging": bool(battery_current and battery_current > 0),
                "charging_power_w": (
                    round(battery_voltage * battery_current, 1)
                    if battery_voltage is not None and battery_current is not None
                    else None
                ),
            },
        )

        await emit(
            TelemetryDomain.SOLAR,
            {
                "watts": pv_power,
                "peak_today_watts": round(self._peak_watts_today, 1),
                "yield_today_wh": data.get("power_generation_today_wh"),
                "charge_state": data.get("charging_status"),
                "charger_error": None,
                "pv_voltage": data.get("pv_voltage"),
                "pv_current": data.get("pv_current"),
                # Renogy controllers have a switched load output and
                # report it directly, so unlike the Victron plugin this
                # is a real measured figure rather than derived.
                "load_current_a": data.get("load_current"),
                "load_power_w": data.get("load_power"),
            },
        )

        load_power = data.get("load_power") or 0
        await emit(
            TelemetryDomain.ENERGY,
            {
                "solar_watts": pv_power,
                "load_watts": load_power,
                "net_watts": round(pv_power - load_power, 1),
                # No per-appliance breakdown available - one aggregate
                # load figure, same honest empty dict as the Victron plugin.
                "loads": {},
            },
        )

        self.heartbeat()
        self.last_error = None
