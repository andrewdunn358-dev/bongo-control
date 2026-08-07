"""
1-Wire temperature sensor plugin (DS18B20).

Reads DS18B20 probes via the Linux kernel's own 1-Wire subsystem, which
exposes each detected sensor as a file under /sys/bus/w1/devices/. No
Python GPIO library needed at all - the kernel driver does the protocol
work, we just read a file. That also means this needs no special
container privileges beyond the /sys mount Docker already provides.

Setup on the Pi (one-time, outside this app):
    sudo raspi-config nonint do_1wire 0
    sudo reboot
then confirm with `ls /sys/bus/w1/devices/` - each probe appears as a
folder starting with "28-" (28 is the DS18B20 family code).

Sensors are DISCOVERED, never hardcoded: each probe has a unique
factory ID (e.g. 28-000000012a0e), so hardcoding one would break for a
second probe and for anyone else running this project. Which physical
location each ID corresponds to is user-configurable (see
`sensor_roles` below), since there's no way to tell from the ID itself
whether a probe is inside the van or outside it.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any

from app.plugins.base import Plugin, PluginStatus
from app.telemetry.bus import TelemetryBus
from app.telemetry.models import TelemetryDomain, TelemetryMessage, TelemetrySource

logger = logging.getLogger("vanos.plugins.onewire_temp")

W1_DEVICES_PATH = Path("/sys/bus/w1/devices")
# DS18B20 family code - every DS18B20's ID starts with this. Other
# 1-Wire device types use different prefixes, so this filters out the
# bus master and any non-temperature devices sharing the bus.
DS18B20_PREFIX = "28-"

DEFAULT_POLL_INTERVAL_SECONDS = 30.0
# A DS18B20 conversion takes up to ~750ms at 12-bit resolution, and the
# kernel driver blocks for that long on read. Well within this, but
# worth knowing why the read is done in a thread (see _read_sensor).
READ_TIMEOUT_SECONDS = 5.0


class OneWireTempPlugin(Plugin):
    name = "onewire_temp"
    display_name = "Temperature Sensors (1-Wire)"
    version = "1.0.0"

    def __init__(self, bus: TelemetryBus) -> None:
        super().__init__(bus)
        self._task: asyncio.Task | None = None
        self._poll_interval = DEFAULT_POLL_INTERVAL_SECONDS
        # Maps sensor ID -> role ("internal" / "external"). Without
        # this, we know a probe exists and what it reads, but not where
        # it physically is - and there's no way to infer that from the
        # hardware.
        self._sensor_roles: dict[str, str] = {}

    def configure(self, config: dict[str, Any]) -> None:
        super().configure(config)
        self._poll_interval = float(config.get("poll_interval_seconds", DEFAULT_POLL_INTERVAL_SECONDS))
        self._sensor_roles = dict(config.get("sensor_roles", {}))

    async def start(self) -> None:
        self.status = PluginStatus.STARTING
        if not W1_DEVICES_PATH.exists():
            self.status = PluginStatus.ERROR
            self.last_error = (
                "1-Wire not enabled on this system - run `sudo raspi-config nonint do_1wire 0` and reboot, "
                "then check `ls /sys/bus/w1/devices/`"
            )
            logger.error(self.last_error)
            return

        self._task = asyncio.create_task(self._run())
        self.status = PluginStatus.RUNNING
        logger.info("1-Wire temperature plugin started (polling every %.0fs)", self._poll_interval)

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        self.status = PluginStatus.STOPPED

    @staticmethod
    def discover_sensor_ids() -> list[str]:
        """Every DS18B20 currently visible on the bus. Also used by the
        API so the UI can list detected probes for role assignment.
        """
        if not W1_DEVICES_PATH.exists():
            return []
        try:
            return sorted(p.name for p in W1_DEVICES_PATH.iterdir() if p.name.startswith(DS18B20_PREFIX))
        except OSError as e:
            logger.warning("Couldn't list 1-Wire devices: %s", e)
            return []

    async def scan(self, duration_seconds: float = 10.0) -> list[dict[str, Any]]:
        """Lists detected probes with a live reading each, so the user
        can identify which physical probe is which (warm one in your
        hand, see which reading moves) before assigning roles.
        """
        results = []
        for sensor_id in self.discover_sensor_ids():
            temp_c = await self._read_sensor(sensor_id)
            results.append(
                {
                    "id": sensor_id,
                    "name": f"DS18B20 {sensor_id}",
                    "temperature_c": temp_c,
                    "role": self._sensor_roles.get(sensor_id),
                }
            )
        return results

    async def _run(self) -> None:
        try:
            while True:
                await self._poll_and_publish()
                await asyncio.sleep(self._poll_interval)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 - keep the plugin alive, surface via status
            self.status = PluginStatus.ERROR
            self.record_error(str(e))
            logger.exception("1-Wire temperature plugin failed")

    async def _poll_and_publish(self) -> None:
        sensor_ids = self.discover_sensor_ids()
        if not sensor_ids:
            self.record_error("No DS18B20 sensors detected on the 1-Wire bus")
            return

        readings: dict[str, float] = {}
        for sensor_id in sensor_ids:
            temp_c = await self._read_sensor(sensor_id)
            if temp_c is not None:
                readings[sensor_id] = temp_c

        if not readings:
            self.record_error("Sensors detected but no valid readings (CRC failures)")
            return

        payload: dict[str, Any] = {
            # Every reading, keyed by sensor ID - so a probe with no
            # role assigned yet still shows up somewhere rather than
            # being silently discarded.
            "sensors": [
                {"id": sensor_id, "temperature_c": temp_c, "role": self._sensor_roles.get(sensor_id)}
                for sensor_id, temp_c in readings.items()
            ],
        }

        # Named fields matching the existing ENVIRONMENT payload shape
        # the frontend already reads, but only when a role has actually
        # been assigned - never guessed. An unassigned probe leaves
        # these null rather than having the app claim an arbitrary
        # sensor is the "internal" one.
        for sensor_id, temp_c in readings.items():
            role = self._sensor_roles.get(sensor_id)
            if role == "internal":
                payload["internal_temp_c"] = temp_c
            elif role == "external":
                payload["external_temp_c"] = temp_c

        payload.setdefault("internal_temp_c", None)
        payload.setdefault("external_temp_c", None)
        # No humidity from a DS18B20 - it's temperature-only. Explicitly
        # null rather than omitted, so the frontend shows "—" rather
        # than a stale value from another source.
        payload.setdefault("humidity_pct", None)

        await self.bus.publish(
            TelemetryMessage(
                domain=TelemetryDomain.ENVIRONMENT,
                source=TelemetrySource.ONEWIRE_TEMP,
                payload=payload,
            )
        )
        self.heartbeat()
        self.last_error = None

    async def _read_sensor(self, sensor_id: str) -> float | None:
        """Reads one probe. Returns None on a CRC failure or read error
        rather than a wrong number - a bad reading is worse than no
        reading here.

        Done via asyncio.to_thread because the kernel driver blocks for
        up to ~750ms during temperature conversion, which would stall
        the whole event loop (and every other plugin with it) if done
        inline.
        """
        path = W1_DEVICES_PATH / sensor_id / "w1_slave"
        try:
            raw = await asyncio.wait_for(asyncio.to_thread(path.read_text), timeout=READ_TIMEOUT_SECONDS)
        except (OSError, asyncio.TimeoutError) as e:
            logger.warning("Failed reading sensor %s: %s", sensor_id, e)
            return None

        return self.parse_w1_slave(raw)

    @staticmethod
    def parse_w1_slave(raw: str) -> float | None:
        """Parses the kernel's two-line w1_slave format:

            78 02 ... : crc=99 YES
            78 02 ... t=39500

        First line ends YES/NO for the CRC check; second carries the
        temperature in thousandths of a degree C. Returns None unless
        the CRC passed AND a temperature was found - a failed CRC means
        the reading is corrupt, not merely imprecise.
        """
        lines = raw.strip().split("\n")
        if len(lines) < 2:
            return None
        if not lines[0].strip().endswith("YES"):
            return None
        if "t=" not in lines[1]:
            return None
        try:
            millidegrees = int(lines[1].split("t=")[1])
        except (ValueError, IndexError):
            return None
        # 85000 is the DS18B20's power-on default register value - it
        # means "no conversion has actually happened yet", not a real
        # 85C reading. Treating it as genuine would show an alarming
        # bogus temperature on first read.
        if millidegrees == 85000:
            return None
        return round(millidegrees / 1000.0, 1)
