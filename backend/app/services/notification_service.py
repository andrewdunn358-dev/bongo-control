"""
NotificationService — success/info/warning/error notifications for
things like battery alerts and plugin connect/disconnect events.

Deliberately reuses the existing TelemetryBus/WebSocket rather than
adding a second channel — notifications are just another domain
(`notification`) flowing over the same single stream. This keeps the
"single WebSocket telemetry" architecture constraint intact: the
frontend still has exactly one connection, just one more message type
arriving on it.
"""

from __future__ import annotations

import time
from enum import Enum

from app.services.telemetry_service import TelemetryService, telemetry_service
from app.telemetry.models import TelemetryDomain, TelemetryMessage, TelemetrySource


class NotificationLevel(str, Enum):
    SUCCESS = "success"
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


class NotificationService:
    def __init__(self, telemetry_service: TelemetryService) -> None:
        self._telemetry = telemetry_service

    async def notify(self, level: NotificationLevel, title: str, message: str) -> None:
        await self._telemetry.publish(
            TelemetryMessage(
                domain=TelemetryDomain.NOTIFICATION,
                source=TelemetrySource.SYSTEM,
                timestamp=time.time(),
                payload={"level": level.value, "title": title, "message": message},
            )
        )

    async def plugin_connected(self, display_name: str) -> None:
        await self.notify(NotificationLevel.SUCCESS, "Plugin connected", f"{display_name} is now running")

    async def plugin_disconnected(self, display_name: str) -> None:
        await self.notify(NotificationLevel.WARNING, "Plugin disconnected", f"{display_name} has stopped")

    async def plugin_error(self, display_name: str, detail: str) -> None:
        await self.notify(NotificationLevel.ERROR, "Plugin error", f"{display_name}: {detail}")


notification_service = NotificationService(telemetry_service)
