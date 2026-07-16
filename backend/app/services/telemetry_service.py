"""
TelemetryService — a thin façade over the TelemetryBus.

Plugins still publish directly onto the bus (that data flow is
unchanged and untouched — Sprint 4 preserves it deliberately). This
service exists for the consumption side: REST routes and other services
go through TelemetryService rather than importing the raw `bus` object
directly, so there's one stable seam if the underlying bus
implementation ever changes (e.g. a real broker, multi-process workers).

    Plugins ──publish──▶ TelemetryBus ◀──read── TelemetryService ──▶ Routes/Services ──▶ UI
"""

from __future__ import annotations

import asyncio

from app.telemetry.bus import TelemetryBus, bus
from app.telemetry.models import TelemetryDomain, TelemetryMessage


class TelemetryService:
    def __init__(self, telemetry_bus: TelemetryBus) -> None:
        self._bus = telemetry_bus

    def latest(self, domain: TelemetryDomain) -> TelemetryMessage | None:
        return self._bus.latest(domain)

    def latest_all(self) -> dict[str, TelemetryMessage]:
        return self._bus.latest_all()

    def history(self, domain: TelemetryDomain) -> list[TelemetryMessage]:
        return self._bus.history(domain)

    async def publish(self, message: TelemetryMessage) -> None:
        await self._bus.publish(message)

    def subscribe(self) -> asyncio.Queue[TelemetryMessage]:
        return self._bus.subscribe()

    def unsubscribe(self, queue: asyncio.Queue[TelemetryMessage]) -> None:
        self._bus.unsubscribe(queue)


telemetry_service = TelemetryService(bus)
