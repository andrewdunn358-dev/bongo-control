"""
BatteryService — the first real "domain service": consumes battery
telemetry already flowing on the bus and derives higher-level behavior
from it (currently: low-battery notifications). This is what the
"Plugins -> Services -> Telemetry Bus -> UI" layering means in
practice — plugins are unaware this exists; it just watches the bus
like any other subscriber and adds value on top.
"""

from __future__ import annotations

import asyncio
import logging

from app.services.notification_service import NotificationLevel, NotificationService
from app.services.telemetry_service import TelemetryService
from app.telemetry.models import TelemetryDomain

logger = logging.getLogger("vanos.battery_service")

LOW_BATTERY_THRESHOLD_PCT = 20.0
CRITICAL_BATTERY_THRESHOLD_PCT = 10.0


class BatteryService:
    def __init__(self, telemetry_service: TelemetryService, notification_service: NotificationService) -> None:
        self._telemetry = telemetry_service
        self._notifications = notification_service
        self._task: asyncio.Task | None = None
        self._last_alerted_below: float | None = None  # avoids re-alerting every tick

    def get_snapshot(self) -> dict | None:
        message = self._telemetry.latest(TelemetryDomain.BATTERY)
        return message.payload if message else None

    async def start_monitoring(self) -> None:
        """Watches the bus for battery readings and raises notifications
        on threshold crossings. Runs as its own background task, started
        once at app startup — independent of any single plugin.
        """
        self._task = asyncio.create_task(self._run())

    async def stop_monitoring(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _run(self) -> None:
        queue = self._telemetry.subscribe()
        try:
            while True:
                message = await queue.get()
                if message.domain != TelemetryDomain.BATTERY:
                    continue
                await self._check_thresholds(message.payload.get("soc_pct"))
        except asyncio.CancelledError:
            raise
        finally:
            self._telemetry.unsubscribe(queue)

    async def _check_thresholds(self, soc_pct: float | None) -> None:
        if soc_pct is None:
            return

        if soc_pct <= CRITICAL_BATTERY_THRESHOLD_PCT:
            if self._last_alerted_below is None or self._last_alerted_below > CRITICAL_BATTERY_THRESHOLD_PCT:
                await self._notifications.notify(
                    NotificationLevel.ERROR, "Critical battery", f"State of charge at {round(soc_pct)}% — charge soon"
                )
            self._last_alerted_below = soc_pct
        elif soc_pct <= LOW_BATTERY_THRESHOLD_PCT:
            if self._last_alerted_below is None or self._last_alerted_below > LOW_BATTERY_THRESHOLD_PCT:
                await self._notifications.notify(
                    NotificationLevel.WARNING, "Low battery", f"State of charge at {round(soc_pct)}%"
                )
            self._last_alerted_below = soc_pct
        else:
            self._last_alerted_below = soc_pct
