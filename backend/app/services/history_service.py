"""
HistoryService — persists telemetry to SQLite for real history graphs
that survive restarts, instead of the Telemetry Bus's small in-memory
ring buffer (still used for short-term things like Recent Events).

Deliberately NOT a 1:1 log of every published message. Simulation and
the Victron plugin both publish roughly once per second; writing every
single one to SQLite forever would mean ~86k rows/day *per domain* on
an SD card — real wear-and-performance concern on a Pi, and pointless
resolution for a graph a human is going to look at (nobody needs
per-second battery % from three days ago). Instead this samples at a
fixed interval (default 60s) and keeps only the latest reading per
domain from each interval — plenty of resolution for real history
graphs, a small fraction of the writes, and a retention window (default
30 days) with periodic pruning keeps total size bounded indefinitely.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time

from app.db.database import SessionLocal
from app.db.models import TelemetryReading
from app.services.telemetry_service import TelemetryService
from app.telemetry.models import TelemetryDomain

logger = logging.getLogger("vanos.history_service")

# Domains worth graphing over time. Notification/system are event-shaped
# or already served fine by the bus's in-memory ring buffer.
PERSISTED_DOMAINS = {
    TelemetryDomain.BATTERY.value,
    TelemetryDomain.SOLAR.value,
    TelemetryDomain.ENERGY.value,
    TelemetryDomain.ENVIRONMENT.value,
    TelemetryDomain.CONNECTIVITY.value,
}

DEFAULT_SAMPLE_INTERVAL_SECONDS = 60
# Per-domain overrides. Sampling rate should match how fast the
# underlying thing actually changes - storing a temperature every
# minute is 60x the rows for no extra insight, and every row is an SD
# card write on a Pi.
#
# Battery/solar/energy deliberately stay at the 60s default: solar
# production curves through the day and overnight battery discharge
# are exactly the cases where minute-level resolution earns its keep.
DOMAIN_SAMPLE_INTERVALS: dict[str, float] = {
    # Ambient temperature moves slowly enough that hourly is plenty -
    # especially in a UK climate.
    TelemetryDomain.ENVIRONMENT.value: 3600,
    # Online/offline state is event-shaped rather than a curve; a
    # reading every 10 minutes is more than enough to see outage
    # windows without logging near-identical rows all day.
    TelemetryDomain.CONNECTIVITY.value: 600,
}
DEFAULT_RETENTION_DAYS = 30
PRUNE_INTERVAL_SECONDS = 6 * 3600  # every 6 hours is plenty for a daily-scale retention window


class HistoryService:
    def __init__(
        self,
        telemetry_service: TelemetryService,
        sample_interval_seconds: float = DEFAULT_SAMPLE_INTERVAL_SECONDS,
        retention_days: float = DEFAULT_RETENTION_DAYS,
    ) -> None:
        self._telemetry = telemetry_service
        self._sample_interval = sample_interval_seconds
        self._retention_days = retention_days
        self._sample_task: asyncio.Task | None = None
        self._prune_task: asyncio.Task | None = None
        self._last_sampled_at: dict[str, float] = {}

    async def start(self) -> None:
        self._sample_task = asyncio.create_task(self._sample_loop())
        self._prune_task = asyncio.create_task(self._prune_loop())

    async def stop(self) -> None:
        for task in (self._sample_task, self._prune_task):
            if task:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

    async def _sample_loop(self) -> None:
        queue = self._telemetry.subscribe()
        try:
            while True:
                message = await queue.get()
                if message.domain not in PERSISTED_DOMAINS:
                    continue

                now = time.time()
                interval = DOMAIN_SAMPLE_INTERVALS.get(message.domain, self._sample_interval)
                if now - self._last_sampled_at.get(message.domain, 0) < interval:
                    continue  # sampled recently enough, skip this one

                self._last_sampled_at[message.domain] = now
                self._persist(message.domain, message.source, message.timestamp, message.payload)
        except asyncio.CancelledError:
            raise
        finally:
            self._telemetry.unsubscribe(queue)

    def _persist(self, domain: str, source: str, timestamp: float, payload: dict) -> None:
        db = SessionLocal()
        try:
            db.add(TelemetryReading(domain=domain, source=source, timestamp=timestamp, payload_json=json.dumps(payload)))
            db.commit()
        except Exception as e:  # noqa: BLE001 - a write failure must not take down the sampling loop
            logger.warning("Failed to persist history reading for %s: %s", domain, e)
            db.rollback()
        finally:
            db.close()

    async def _prune_loop(self) -> None:
        try:
            while True:
                self._prune()
                await asyncio.sleep(PRUNE_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            raise

    def _prune(self) -> None:
        cutoff = time.time() - (self._retention_days * 86400)
        db = SessionLocal()
        try:
            deleted = db.query(TelemetryReading).filter(TelemetryReading.timestamp < cutoff).delete()
            db.commit()
            if deleted:
                logger.info("Pruned %d history rows older than %d days", deleted, self._retention_days)
        except Exception as e:  # noqa: BLE001
            logger.warning("Failed to prune old history: %s", e)
            db.rollback()
        finally:
            db.close()

    def query(self, domain: str, since_timestamp: float) -> list[dict]:
        db = SessionLocal()
        try:
            rows = (
                db.query(TelemetryReading)
                .filter(TelemetryReading.domain == domain, TelemetryReading.timestamp >= since_timestamp)
                .order_by(TelemetryReading.timestamp)
                .all()
            )
            return [
                {
                    "domain": r.domain,
                    "source": r.source,
                    "timestamp": r.timestamp,
                    "payload": json.loads(r.payload_json),
                }
                for r in rows
            ]
        finally:
            db.close()
