"""
IntelligenceRunner — subscribes to the bus, recomputes on a throttle,
keeps IntelligenceEngine.latest() fresh for the REST endpoint.

This ran alongside the old PowerBudgetService for a while, deliberately:
that service was working code and a one-shot migration wasn't worth the
risk in the same change that introduced this engine. The consolidation
its docstring promised has now happened - PowerBudgetService is deleted.
It had been computing estimated runtime, heater-all-night and tomorrow's
outlook on its own 30-second loop, querying six hours of battery history
from SQLite each time, and publishing them to a SYSTEM telemetry domain
that nothing read: the providers here had taken over every one of those
figures, and the Overview screen reads this engine's mission brief.
"""

from __future__ import annotations

import asyncio
import logging
import time

from app.intelligence.engine import IntelligenceEngine
from app.services.telemetry_service import TelemetryService
from app.telemetry.models import TelemetryDomain

logger = logging.getLogger("vanos.intelligence_runner")

RECOMPUTE_MIN_INTERVAL_SECONDS = 30


class IntelligenceRunner:
    def __init__(self, telemetry_service: TelemetryService, engine: IntelligenceEngine) -> None:
        self._telemetry = telemetry_service
        self._engine = engine
        self._task: asyncio.Task | None = None
        self._last_computed_at: float = 0.0

    async def start(self) -> None:
        # Compute once immediately so the endpoint has something to
        # serve right away, rather than waiting for the first BATTERY/
        # WEATHER message to arrive.
        self._engine.compute()
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
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
                if message.domain not in (TelemetryDomain.BATTERY.value, TelemetryDomain.WEATHER.value):
                    continue
                now = time.time()
                if now - self._last_computed_at < RECOMPUTE_MIN_INTERVAL_SECONDS:
                    continue
                self._last_computed_at = now
                self._engine.compute()
        except asyncio.CancelledError:
            raise
        finally:
            self._telemetry.unsubscribe(queue)
