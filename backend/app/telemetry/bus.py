"""
TelemetryBus: the single point through which ALL data flows.

    Simulation Plugin ─┐
    Victron Plugin ─────┼──▶ TelemetryBus ──▶ FastAPI / WebSocket ──▶ React
    Battery Plugin ─────┘

Design intent:
- Plugins call `bus.publish(message)`. They never talk to the API or
  websocket layer directly.
- Consumers (the websocket manager, REST snapshot cache, future logging
  consumers) call `bus.subscribe()` and get an async queue of messages.
- The bus also keeps a `latest` snapshot per domain, so REST endpoints
  can answer "what's the current battery state?" without needing to be
  a subscriber themselves.

This is intentionally dependency-free (no Redis, no external broker)
because Sprint 1 targets a single Raspberry Pi / single container.
Swapping in a real broker later only means changing this file.
"""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict

from app.telemetry.models import TelemetryDomain, TelemetryMessage

logger = logging.getLogger("vanos.telemetry")


class TelemetryBus:
    def __init__(self, history_size: int = 200) -> None:
        self._subscribers: set[asyncio.Queue[TelemetryMessage]] = set()
        self._latest: dict[TelemetryDomain, TelemetryMessage] = {}
        self._history: dict[TelemetryDomain, list[TelemetryMessage]] = defaultdict(list)
        self._history_size = history_size
        self._lock = asyncio.Lock()

    async def publish(self, message: TelemetryMessage) -> None:
        """Called by plugins to emit a new reading."""
        async with self._lock:
            self._latest[message.domain] = message
            domain_history = self._history[message.domain]
            domain_history.append(message)
            if len(domain_history) > self._history_size:
                domain_history.pop(0)

        dead: list[asyncio.Queue[TelemetryMessage]] = []
        for queue in self._subscribers:
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                logger.warning("Subscriber queue full, dropping message for %s", message.domain)
                dead.append(queue)

        for queue in dead:
            self._subscribers.discard(queue)

    def subscribe(self) -> asyncio.Queue[TelemetryMessage]:
        """Returns a new queue that will receive every future message.
        Callers (e.g. the websocket handler) MUST call unsubscribe()
        when done, or the queue will leak.
        """
        queue: asyncio.Queue[TelemetryMessage] = asyncio.Queue(maxsize=500)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[TelemetryMessage]) -> None:
        self._subscribers.discard(queue)

    def latest(self, domain: TelemetryDomain) -> TelemetryMessage | None:
        """Current snapshot for a domain — used by REST endpoints."""
        return self._latest.get(domain)

    def latest_all(self) -> dict[str, TelemetryMessage]:
        # `message.domain` is stored as a plain str at runtime (pydantic
        # use_enum_values=True), so keys here are already strings.
        return dict(self._latest)

    def history(self, domain: TelemetryDomain) -> list[TelemetryMessage]:
        return list(self._history.get(domain, []))


# A single process-wide bus instance. In multi-worker deployments this
# would need to move to a shared broker (Redis pub/sub, etc.) — noted
# here deliberately so it isn't forgotten later.
bus = TelemetryBus()
