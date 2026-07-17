"""
Victron SmartSolar MPPT Bluetooth plugin.

Uses Victron's "Instant Readout" BLE advertisement protocol: a passive,
no-pairing-required broadcast that the whole open Victron BLE community
(Home Assistant's official integration, ESPHome, this plugin) relies on.
Decryption/parsing goes through the open-source `victron-ble` library
rather than reimplementing AES-CTR decryption ourselves.

READ docs/victron_ble_integration.md BEFORE deploying this. In short:

- You need the device's per-unit encryption_key from the VictronConnect
  app (Settings -> Product Info -> Instant Readout) - there is no way
  to obtain or guess this from the plugin itself.
- Several fields the original spec asked for are NOT available via this
  protocol and are not provided by this plugin: PV voltage/current
  separately (only combined solar power), maximum power today (we
  compute a running peak instead - see below), firmware version, and
  device name is only available as the BLE advertised name, not the
  encrypted payload. Getting the missing fields would require Victron's
  undocumented, paired GATT-based protocol, which is far more fragile
  and out of scope here.
- State of charge (soc_pct) is NOT available from an MPPT at all - it
  only measures battery voltage and its own charging current, not
  accumulated charge. That needs a SmartShunt (a separate, future
  milestone). This plugin publishes voltage but leaves soc_pct as None
  rather than fabricating a number - the frontend is built to show "—"
  for that gracefully.

"Auto reconnect" for BLE advertisement scanning doesn't mean the same
thing as a TCP reconnect - there's no persistent connection to lose.
Instead, this plugin runs a supervisor loop that watches for the
advertisement stream going stale (no packet in STALE_AFTER_SECONDS) and
restarts the BLE scan if so, which is the correct "reconnect" behavior
for this transport.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import date
from typing import Any

from bleak import BleakScanner
from bleak.backends.device import BLEDevice
from bleak.backends.scanner import AdvertisementData
from victron_ble.devices.base import OperationMode
from victron_ble.devices.solar_charger import SolarCharger, SolarChargerData

from app.plugins.base import Plugin, PluginStatus
from app.telemetry.bus import TelemetryBus
from app.telemetry.models import TelemetryDomain, TelemetryMessage, TelemetrySource

logger = logging.getLogger("vanos.plugins.victron_mppt")

VICTRON_MANUFACTURER_ID = 0x02E1
STALE_AFTER_SECONDS = 60
SUPERVISOR_INTERVAL_SECONDS = 10
MAX_BACKOFF_SECONDS = 30

# Charge states that mean "actively pushing current into the battery" —
# used to derive battery.charging since the MPPT doesn't report a
# separate boolean for it.
CHARGING_STATES = {
    OperationMode.BULK,
    OperationMode.ABSORPTION,
    OperationMode.FLOAT,
    OperationMode.STORAGE,
    OperationMode.EQUALIZE_MANUAL,
    OperationMode.REPEATED_ABSORPTION,
}


class VictronMPPTPlugin(Plugin):
    name = "victron_mppt"
    display_name = "Victron SmartSolar MPPT"
    version = "1.0.0"

    def __init__(self, bus: TelemetryBus) -> None:
        super().__init__(bus)
        self._scanner: BleakScanner | None = None
        self._supervisor_task: asyncio.Task | None = None
        self._decoder: SolarCharger | None = None
        self._mac_address: str | None = None
        self._device_name: str | None = None
        self._last_advertisement_at: float | None = None
        self._peak_watts_today: float = 0.0
        self._peak_watts_date: date = date.today()
        self._reconnect_attempts = 0

    def configure(self, config: dict[str, Any]) -> None:
        super().configure(config)
        self._mac_address = config.get("mac_address")
        key = config.get("encryption_key")
        self._decoder = SolarCharger(key) if key else None

    def health(self) -> dict[str, Any]:
        base = super().health()
        base["device_name"] = self._device_name
        base["mac_address"] = self._mac_address
        return base

    async def scan(self, duration_seconds: float = 10.0) -> list[dict[str, Any]]:
        """One-shot discovery scan, independent of start()/stop() and of
        whether this plugin is currently enabled. Reports every Victron
        device seen (by manufacturer ID, regardless of decryption
        success) so the user can confirm hardware is actually visible
        over Bluetooth at all — the single most useful diagnostic when
        "nothing is happening" and it's unclear whether that's a config
        problem, a range/power problem, or a Docker/Bluetooth-access
        problem.
        """
        found: dict[str, dict[str, Any]] = {}

        def on_advertisement(device: BLEDevice, advertisement: AdvertisementData) -> None:
            data = advertisement.manufacturer_data.get(VICTRON_MANUFACTURER_ID)
            if not data:
                return

            entry: dict[str, Any] = {
                "mac_address": device.address,
                "name": device.name,
                "rssi": advertisement.rssi,
                "is_instant_readout": data.startswith(b"\x10"),
                "decrypt_success": None,
                "model_name": None,
            }

            if self._decoder is not None and entry["is_instant_readout"]:
                try:
                    parsed = self._decoder.parse(data)
                    entry["decrypt_success"] = True
                    entry["model_name"] = parsed.get_model_name()
                except Exception:  # noqa: BLE001 - wrong key for this specific device is a normal, expected outcome here
                    entry["decrypt_success"] = False

            found[device.address] = entry

        scanner = BleakScanner(detection_callback=on_advertisement)
        await scanner.start()
        await asyncio.sleep(duration_seconds)
        await scanner.stop()

        return list(found.values())

    async def start(self) -> None:
        if not self._decoder:
            self.status = PluginStatus.ERROR
            self.record_error("No encryption_key configured — see docs/victron_ble_integration.md")
            return

        self.status = PluginStatus.STARTING
        self._supervisor_task = asyncio.create_task(self._run_supervisor())

    async def stop(self) -> None:
        if self._supervisor_task:
            self._supervisor_task.cancel()
            try:
                await self._supervisor_task
            except asyncio.CancelledError:
                pass
            self._supervisor_task = None
        await self._stop_scanner()
        self.status = PluginStatus.STOPPED

    async def _stop_scanner(self) -> None:
        if self._scanner:
            try:
                await self._scanner.stop()
            except Exception as e:  # noqa: BLE001 - best-effort cleanup
                logger.debug("Error stopping BLE scanner (ignored): %s", e)
            self._scanner = None

    async def _run_supervisor(self) -> None:
        """Owns the BLE scanner's lifecycle: starts it, and restarts it
        if the advertisement stream goes stale. This IS the "auto
        reconnect" behavior for a broadcast-based protocol — there's no
        persistent connection to drop, just a periodic broadcast that
        can stop arriving (device out of range, adapter hiccup, BlueZ
        restart), which we detect and recover from here.
        """
        try:
            while True:
                await self._ensure_scanning()
                await asyncio.sleep(SUPERVISOR_INTERVAL_SECONDS)

                if self.status == PluginStatus.RUNNING and self._last_advertisement_at is not None:
                    silence = time.time() - self._last_advertisement_at
                    if silence > STALE_AFTER_SECONDS:
                        logger.warning("No Victron advertisement in %.0fs, restarting BLE scan", silence)
                        self.record_error(f"No data for {round(silence)}s — restarting scan")
                        await self._stop_scanner()
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 - a plugin must never crash the app
            self.status = PluginStatus.ERROR
            self.record_error(str(e))

    async def _ensure_scanning(self) -> None:
        if self._scanner is not None:
            return
        try:
            self._scanner = BleakScanner(detection_callback=self._on_advertisement)
            await self._scanner.start()
            self.status = PluginStatus.RUNNING
            self._reconnect_attempts = 0
        except Exception as e:
            # Expected in any environment without a real Bluetooth
            # adapter (e.g. no BlueZ/D-Bus, no BT hardware) — this is
            # the graceful-degradation path, not a crash.
            self._scanner = None
            self._reconnect_attempts += 1
            self.status = PluginStatus.ERROR
            self.record_error(f"Failed to start BLE scan: {e}")
            await asyncio.sleep(min(MAX_BACKOFF_SECONDS, 2**self._reconnect_attempts))

    def _on_advertisement(self, device: BLEDevice, advertisement: AdvertisementData) -> None:
        """Bleak calls this synchronously (not a coroutine) for every
        advertisement it sees — filter fast, decrypt, then hand off the
        actual publish to the event loop as a task.
        """
        if self._mac_address and device.address.lower() != self._mac_address.lower():
            return

        data = advertisement.manufacturer_data.get(VICTRON_MANUFACTURER_ID)
        if not data or not data.startswith(b"\x10"):
            return  # not a Victron Instant Readout advertisement

        assert self._decoder is not None  # start() already checked this
        try:
            parsed = self._decoder.parse(data)
        except Exception as e:  # noqa: BLE001 - a malformed/foreign packet must not kill the scanner
            self.record_error(f"Failed to decrypt advertisement: {e}")
            return

        self._last_advertisement_at = time.time()
        self._device_name = device.name or self._device_name
        self.last_error = None  # clear any stale error now that data is flowing again
        self.heartbeat()

        asyncio.create_task(self._publish(parsed))

    async def _publish(self, data: SolarChargerData) -> None:
        solar_power = data.get_solar_power() or 0.0

        today = date.today()
        if today != self._peak_watts_date:
            self._peak_watts_date = today
            self._peak_watts_today = 0.0
        self._peak_watts_today = max(self._peak_watts_today, solar_power)

        charge_state = data.get_charge_state()
        charger_error = data.get_charger_error()
        battery_voltage = data.get_battery_voltage()
        battery_current = data.get_battery_charging_current()
        yield_today_wh = data.get_yield_today()

        now = time.time()

        async def emit(domain: TelemetryDomain, payload: dict) -> None:
            await self.bus.publish(
                TelemetryMessage(domain=domain, source=TelemetrySource.VICTRON_MPPT, timestamp=now, payload=payload)
            )

        # Note: no cloud_cover_pct - that's a simulation-only synthetic
        # concept (no real cloud sensor here). peak_today_watts is a
        # genuine running max we compute ourselves, not a hardcoded
        # constant like the simulation's.
        await emit(
            TelemetryDomain.SOLAR,
            {
                "watts": round(solar_power, 1),
                "peak_today_watts": round(self._peak_watts_today, 1),
                "yield_today_wh": yield_today_wh,
                "charge_state": charge_state.name.lower() if charge_state else None,
                "charger_error": (
                    None if (charger_error is None or charger_error.name == "NO_ERROR") else charger_error.name.lower()
                ),
            },
        )

        if battery_voltage is not None:
            charging_power_w = (
                round(battery_voltage * battery_current, 1) if battery_current is not None else None
            )
            await emit(
                TelemetryDomain.BATTERY,
                {
                    # Not available from an MPPT alone — needs a SmartShunt
                    # (future milestone). Left as None rather than faked;
                    # the frontend shows "—" for this gracefully.
                    "soc_pct": None,
                    "voltage": round(battery_voltage, 2),
                    "charging": charge_state in CHARGING_STATES if charge_state else False,
                    "charging_power_w": charging_power_w,
                },
            )
