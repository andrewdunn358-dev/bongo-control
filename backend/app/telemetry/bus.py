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

from app.telemetry.models import TelemetryDomain, TelemetryMessage, TelemetrySource

logger = logging.getLogger("vanos.telemetry")


# Lowest priority first - later sources overwrite earlier ones for any
# field they both report. Only domains with more than one publisher need
# an entry.
FIELD_PRECEDENCE: dict[str, list] = {
    TelemetryDomain.BATTERY: [TelemetrySource.VICTRON_MPPT, TelemetrySource.VICTRON_SHUNT],
}


class TelemetryBus:
    def __init__(self, history_size: int = 200) -> None:
        self._subscribers: set[asyncio.Queue[TelemetryMessage]] = set()
        self._latest: dict[TelemetryDomain, TelemetryMessage] = {}
        self._history: dict[TelemetryDomain, list[TelemetryMessage]] = defaultdict(list)
        self._history_size = history_size
        self._lock = asyncio.Lock()
        self._latest_by_source: dict[tuple, TelemetryMessage] = {}

    async def publish(self, message: TelemetryMessage) -> None:
        """Called by plugins to emit a new reading."""
        async with self._lock:
            # MERGE rather than overwrite, so two plugins publishing
            # the same domain don't erase each other, WITH PRECEDENCE so
            # the more accurate source wins where they overlap.
            #
            # The SmartShunt and the MPPT both publish BATTERY. The
            # shunt measures at the battery post and knows current,
            # consumed_ah and state of charge; the MPPT measures at its
            # own terminals - which reads higher while charging by the
            # drop across the cable - and knows solar and charge power.
            # Plain assignment meant whichever arrived last won, so the
            # Home screen alternated between 12.84V and 12.49V for the
            # same battery.
            #
            # Both are correct readings of different points; the shunt
            # is the one that answers "what is the battery doing", so it
            # wins for the fields both report. A field is also only ever
            # overwritten by a NON-None value, so a source that cannot
            # measure something never blanks one that can.
            self._latest_by_source[(message.domain, message.source)] = message
            order = FIELD_PRECEDENCE.get(message.domain)
            merged: dict = {}
            if order:
                # Undeclared sources first, so a declared one always
                # wins over them.
                for (domain, source), held in self._latest_by_source.items():
                    if domain == message.domain and source not in order:
                        merged.update({k: v for k, v in held.payload.items() if v is not None})
                # Then declared sources in precedence order, lowest
                # first. The INCOMING message is deliberately not
                # appended afterwards - doing so let whichever plugin
                # published most recently override the precedence, which
                # is exactly the alternating-voltage bug this replaces.
                for source in order:
                    held = self._latest_by_source.get((message.domain, source))
                    if held is not None:
                        merged.update({k: v for k, v in held.payload.items() if v is not None})
            else:
                merged = dict(message.payload)
            message = message.model_copy(update={"payload": merged})
            self._latest[message.domain] = message
            domain_history = self._history[message.domain]
            domain_history.append(message)
            if len(domain_history) > self._history_size:
                domain_history.pop(0)

        for queue in self._subscribers:
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                # A momentarily slow client (backgrounded phone, weak
                # signal) that fills its queue once should NOT be dropped
                # from the bus forever — that silently freezes its
                # dashboard until a manual reload. Instead drop the OLDEST
                # queued message to make room for the newest (which is the
                # one that matters for a live telemetry view).
                try:
                    queue.get_nowait()
                    queue.put_nowait(message)
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    logger.warning("Subscriber queue full, dropping message for %s", message.domain)

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
