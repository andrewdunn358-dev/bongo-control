"""
Victron SmartShunt Bluetooth plugin.

The counterpart to victron_mppt, and the thing that answers the question
that plugin explicitly could not:

    "State of charge (soc_pct) is NOT available from an MPPT at all - it
    only measures battery voltage and its own charging current, not
    accumulated charge. That needs a SmartShunt (a separate, future
    milestone)."

This is that milestone. A shunt sits in the battery's negative lead and
measures every amp in and out, so it reports real current, consumed
amp-hours and a true state of charge rather than a guess inferred from
resting voltage - which this project has always refused to fake.

Same transport as the MPPT: Victron's "Instant Readout" BLE broadcast,
passive, no pairing, decrypted by the open-source `victron-ble` library.
The per-device encryption key comes from VictronConnect (Settings ->
Product info -> Instant readout via Bluetooth) and cannot be derived
here. See docs/victron_ble_integration.md.

WHY A SEPARATE PLUGIN rather than extending victron_mppt: they are two
physical devices with different MACs, different keys and different
payload types, and either can be absent. Bolting a second decoder onto
one plugin would mean one health state, one error string and one
enable/disable for two independent pieces of hardware - so a shunt going
quiet would look like the solar controller failing.

WHAT IT DOES NOT DO: the shunt reports total current at the battery, not
per-circuit. It cannot tell you what the fridge draws separately from the
Pi - that needs either per-circuit sensing or switching things off and
watching the number, which is exactly how the base load was first
measured at 9 W.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from bleak.backends.device import BLEDevice
from bleak.backends.scanner import AdvertisementData
from victron_ble.devices.battery_monitor import BatteryMonitor, BatteryMonitorData

from app.plugins.base import Plugin, PluginStatus
from app.plugins.ble_scanner import shared_ble_scanner
from app.telemetry.bus import TelemetryBus
from app.telemetry.models import TelemetryDomain, TelemetryMessage, TelemetrySource

logger = logging.getLogger("vanos.plugins.victron_shunt")

VICTRON_MANUFACTURER_ID = 0x02E1
STALE_AFTER_SECONDS = 60
SUPERVISOR_INTERVAL_SECONDS = 10
MAX_BACKOFF_SECONDS = 30


class VictronShuntPlugin(Plugin):
    name = "victron_shunt"
    display_name = "Victron SmartShunt"
    version = "1.0.0"

    def __init__(self, bus: TelemetryBus) -> None:
        super().__init__(bus)
        self._supervisor_task: asyncio.Task | None = None
        self._decoder: BatteryMonitor | None = None
        self._mac_address: str | None = None
        self._device_name: str | None = None
        self._last_advertisement_at: float | None = None
        self._reconnect_attempts = 0

    def configure(self, config: dict[str, Any]) -> None:
        super().configure(config)
        self._mac_address = config.get("mac_address")
        key = config.get("encryption_key")
        self._decoder = BatteryMonitor(key) if key else None

    def health(self) -> dict[str, Any]:
        base = super().health()
        base["device_name"] = self._device_name
        base["mac_address"] = self._mac_address
        return base

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
        await shared_ble_scanner.unsubscribe(self.name)

    async def _run_supervisor(self) -> None:
        """Same shape as the MPPT plugin's supervisor: a broadcast
        protocol has no connection to drop, so "reconnect" means noticing
        the advertisements have stopped arriving and restarting the scan.

        Worth knowing on this Pi specifically: its Bluetooth controller
        has locked up hard before ("Controller not accepting commands
        anymore"), taking all Victron telemetry down for nine hours until
        a reboot. This loop cannot recover from that - it is a kernel/
        hardware level failure - but it does surface it as an error on
        the plugin rather than the data silently stopping.
        """
        try:
            while True:
                await self._ensure_scanning()
                await asyncio.sleep(SUPERVISOR_INTERVAL_SECONDS)

                if self.status == PluginStatus.RUNNING and self._last_advertisement_at is not None:
                    silence = time.time() - self._last_advertisement_at
                    if silence > STALE_AFTER_SECONDS:
                        logger.warning("No SmartShunt advertisement in %.0fs, restarting BLE scan", silence)
                        self.record_error(f"No data for {round(silence)}s — restarting scan")
                        await shared_ble_scanner.restart()
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 - a plugin must never crash the app
            self.status = PluginStatus.ERROR
            self.record_error(str(e))

    async def _ensure_scanning(self) -> None:
        """Subscribe to the SHARED scanner rather than starting our own.

        BlueZ allows one discovery session per adapter, so two plugins
        each owning a BleakScanner meant the second failed forever with
        "[org.bluez.Error.InProgress] Operation already in progress".
        Both Victron devices broadcast on the same protocol and the one
        adapter hears both, so one scan fanned out is all that was ever
        needed.
        """
        if shared_ble_scanner.running and self.status == PluginStatus.RUNNING:
            return
        try:
            await shared_ble_scanner.subscribe(self.name, self._on_advertisement)
            await shared_ble_scanner.ensure_running()
            self.status = PluginStatus.RUNNING
            self._reconnect_attempts = 0
        except Exception as e:  # noqa: BLE001
            self._reconnect_attempts += 1
            self.status = PluginStatus.ERROR
            self.record_error(f"Failed to start BLE scan: {e}")
            await asyncio.sleep(min(MAX_BACKOFF_SECONDS, 2**self._reconnect_attempts))

    def _on_advertisement(self, device: BLEDevice, advertisement: AdvertisementData) -> None:
        """Bleak calls this synchronously for every advertisement seen -
        filter fast, decrypt, hand the publish off to the loop.

        The MAC filter matters more here than it does for a single
        device: with both a SmartSolar and a SmartShunt broadcasting,
        every packet reaches both plugins, and each would otherwise try
        to decrypt the other's payload with the wrong key on every
        advertisement.
        """
        if self._mac_address and device.address.lower().replace(":", "") != self._mac_address.lower().replace(":", ""):
            return

        data = advertisement.manufacturer_data.get(VICTRON_MANUFACTURER_ID)
        if not data or not data.startswith(b"\x10"):
            return

        assert self._decoder is not None
        try:
            parsed = self._decoder.parse(data)
        except Exception as e:  # noqa: BLE001 - a foreign or malformed packet must not kill the scanner
            # NOT an error, and deliberately not recorded as one. With
            # more than one Victron device broadcasting, every packet
            # reaches every plugin and each will fail to decrypt the
            # others' payloads with its own key - "Incorrect
            # advertisement key" on someone else's advertisement is the
            # normal, expected case. Recording it marked a perfectly
            # healthy plugin as ERROR several times a minute.
            #
            # A genuinely wrong key shows up as this plugin never
            # receiving anything, which the staleness supervisor already
            # reports.
            logger.debug("Ignoring an advertisement this plugin can't decrypt: %s", e)
            return

        self._last_advertisement_at = time.time()
        self._device_name = device.name or self._device_name
        self.last_error = None
        self.heartbeat()

        asyncio.create_task(self._publish(parsed))

    async def _publish(self, data: BatteryMonitorData) -> None:
        voltage = data.get_voltage()
        current = data.get_current()
        soc = data.get_soc()
        consumed_ah = data.get_consumed_ah()
        # The shunt's AUX input. Victron calls it "starter battery"
        # because that is the usual use; here it is the external
        # leisure battery, so it is published under an honest name.
        # Voltage only - the aux input cannot measure current, so there
        # is no state of charge for that battery and none is invented.
        aux_voltage = data.get_starter_voltage()
        remaining_mins = data.get_remaining_mins()

        # Sign convention: victron-ble reports current POSITIVE into the
        # battery and negative out of it, which is the same convention
        # the Power screen already uses for charge_power_w. Published as
        # given rather than flipped, so "negative means draining" holds
        # everywhere in the app.
        power_w = round(voltage * current, 1) if (voltage is not None and current is not None) else None

        payload: dict[str, Any] = {
            "voltage": round(voltage, 2) if voltage is not None else None,
            "current_a": round(current, 2) if current is not None else None,
            "power_w": power_w,
            "soc_pct": round(soc, 1) if soc is not None else None,
            "consumed_ah": round(consumed_ah, 2) if consumed_ah is not None else None,
            "external_voltage": round(aux_voltage, 2) if aux_voltage is not None else None,
            # Victron reports a very large number when it cannot estimate
            # (i.e. the battery is charging, so it will never run out).
            # Publishing that as a real figure would put something absurd
            # like "34 days remaining" on screen, so it becomes None and
            # the UI shows a dash - the same honesty rule as refusing to
            # infer SoC from voltage.
            "time_remaining_mins": (
                int(remaining_mins) if remaining_mins is not None and remaining_mins < 60 * 24 * 7 else None
            ),
            "charging": bool(current is not None and current > 0.05),
        }

        await self.bus.publish(
            TelemetryMessage(
                domain=TelemetryDomain.BATTERY,
                source=TelemetrySource.VICTRON_SHUNT,
                payload=payload,
            )
        )
