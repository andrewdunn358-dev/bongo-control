"""
One BLE scanner, shared by every plugin that needs advertisements.

WHY THIS EXISTS: BlueZ permits a single active discovery session per
adapter. When the SmartShunt plugin was added it mirrored the MPPT
plugin's structure faithfully - including its own BleakScanner - and the
second one to start failed repeatedly with:

    [org.bluez.Error.InProgress] Operation already in progress

Both devices broadcast on the same protocol and the same adapter hears
both, so there was never a need for two scanners: one scan, fanned out
to whoever is listening.

Deliberately reference-counted rather than started once and left
running. The scan is a real radio activity with a power cost, on a van
that is often running off a battery through a long winter night, so it
stops when the last subscriber leaves - disabling both Victron plugins
genuinely turns the radio scanning off rather than leaving it spinning
for nobody.

A failing subscriber must not take the scan down for the others, so
callbacks are individually guarded: one plugin throwing on a malformed
packet cannot stop the other receiving its data.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable

from bleak import BleakScanner
from bleak.backends.device import BLEDevice
from bleak.backends.scanner import AdvertisementData

logger = logging.getLogger("vanos.plugins.ble_scanner")

Callback = Callable[[BLEDevice, AdvertisementData], None]


class SharedBleScanner:
    def __init__(self) -> None:
        self._scanner: BleakScanner | None = None
        self._subscribers: dict[str, Callback] = {}
        self._lock = asyncio.Lock()

    @property
    def running(self) -> bool:
        return self._scanner is not None

    async def subscribe(self, name: str, callback: Callback) -> None:
        """Register a callback and start the scan if it isn't running.

        Raises if the scan cannot be started, so the calling plugin can
        report its own health honestly rather than sitting in STARTING
        forever.
        """
        async with self._lock:
            self._subscribers[name] = callback
            if self._scanner is not None:
                # Logged even when the scan is already up, otherwise a
                # plugin attaching to a running scan is completely
                # silent and there is no way to tell "subscribed fine"
                # from "never started" in the log.
                logger.info("%s subscribed to the shared BLE scan (%d total)", name, len(self._subscribers))
                return
            scanner = BleakScanner(detection_callback=self._dispatch)
            try:
                await scanner.start()
            except Exception:
                # Leave the subscriber registered: the plugin's own
                # supervisor will retry, and if a different plugin
                # succeeds first this one is already on the list and
                # starts receiving with no further action.
                raise
            self._scanner = scanner
            logger.info("Shared BLE scan started (%d subscriber(s))", len(self._subscribers))

    async def unsubscribe(self, name: str) -> None:
        async with self._lock:
            self._subscribers.pop(name, None)
            if self._subscribers or self._scanner is None:
                return
            try:
                await self._scanner.stop()
            except Exception as e:  # noqa: BLE001 - best-effort cleanup
                logger.debug("Error stopping shared BLE scanner (ignored): %s", e)
            self._scanner = None
            logger.info("Shared BLE scan stopped - no subscribers left")

    async def restart(self) -> None:
        """Tear the scan down so the next subscribe() rebuilds it. Used
        by a plugin's staleness supervisor when advertisements stop
        arriving."""
        async with self._lock:
            if self._scanner is None:
                return
            try:
                await self._scanner.stop()
            except Exception as e:  # noqa: BLE001
                logger.debug("Error restarting shared BLE scanner (ignored): %s", e)
            self._scanner = None

    async def ensure_running(self) -> None:
        async with self._lock:
            if self._scanner is not None or not self._subscribers:
                return
            scanner = BleakScanner(detection_callback=self._dispatch)
            await scanner.start()
            self._scanner = scanner
            logger.info("Shared BLE scan restarted (%d subscriber(s))", len(self._subscribers))

    def _dispatch(self, device: BLEDevice, advertisement: AdvertisementData) -> None:
        for name, callback in list(self._subscribers.items()):
            try:
                callback(device, advertisement)
            except Exception as e:  # noqa: BLE001
                # Guarded per subscriber on purpose - one plugin
                # throwing on a packet it does not understand must not
                # stop the others receiving theirs.
                logger.warning("BLE subscriber %s raised on an advertisement: %s", name, e)


shared_ble_scanner = SharedBleScanner()
