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
    # Weather is persisted so the intelligence layer can learn how much
    # energy the array actually converts per unit of available sunlight
    # (self-calibrated panel-performance) - it needs each past day's
    # forecast solar radiation, which only this history provides. Stored
    # half-hourly (see DOMAIN_SAMPLE_INTERVALS); the forecast barely
    # moves between updates so that's ample and keeps the row count tiny.
    TelemetryDomain.WEATHER.value,
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
    # Forecast changes slowly; half-hourly is plenty and keeps the
    # (relatively large) weather payload from bloating the DB.
    TelemetryDomain.WEATHER.value: 1800,
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

    def query(self, domain: str, since_timestamp: float, max_points: int | None = None) -> list[dict]:
        """Persisted readings for a domain since a timestamp.

        max_points optionally downsamples the result. This matters
        because sampling intervals are per-domain: environment is
        hourly (~720 points over 30 days, fine as-is) but battery and
        solar sample every 60s (~43,000 points over 30 days), which is
        far more than any chart can render usefully and a lot to push
        over a slow connection to a phone.

        Done server-side rather than in the browser deliberately: the
        Pi is the weakest link, and sending 43,000 points so the client
        can discard most of them wastes the Pi's CPU, the network, and
        the phone's memory. Downsampling here benefits every client.
        """
        db = SessionLocal()
        try:
            rows = (
                db.query(TelemetryReading)
                .filter(TelemetryReading.domain == domain, TelemetryReading.timestamp >= since_timestamp)
                .order_by(TelemetryReading.timestamp)
                .all()
            )
            readings = [
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

        if max_points is None or len(readings) <= max_points:
            return readings
        return self._downsample(readings, max_points)

    @staticmethod
    def _downsample(readings: list[dict], max_points: int) -> list[dict]:
        """Buckets readings by time and averages numeric fields within
        each bucket.

        Averaging rather than picking every Nth reading, because
        dropping points loses spikes entirely - a brief high solar peak
        would simply vanish if it happened to fall between kept
        samples. Averaging preserves the shape of the curve.

        Non-numeric fields (booleans, strings, nested dicts like a
        weather forecast, the 1-Wire sensors array) are taken from the
        LAST reading in each bucket rather than averaged, since
        averaging them is meaningless. Booleans specifically: averaging
        charging true/false into 0.6 would be nonsense, so the most
        recent value in the bucket wins.
        """
        bucket_size = len(readings) / max_points
        buckets: list[list[dict]] = [[] for _ in range(max_points)]
        for i, reading in enumerate(readings):
            index = min(int(i / bucket_size), max_points - 1)
            buckets[index].append(reading)

        result: list[dict] = []
        for bucket in buckets:
            if not bucket:
                continue
            last = bucket[-1]
            merged_payload = dict(last["payload"])

            # Average only genuinely numeric fields, and only where
            # every reading in the bucket has a usable number - a field
            # that's null in some readings (an unassigned sensor, a
            # missing shunt) shouldn't be silently averaged over the
            # subset that happens to have values.
            for key, value in last["payload"].items():
                if isinstance(value, bool) or not isinstance(value, (int, float)):
                    continue
                values = [
                    r["payload"].get(key)
                    for r in bucket
                    if isinstance(r["payload"].get(key), (int, float)) and not isinstance(r["payload"].get(key), bool)
                ]
                if len(values) == len(bucket):
                    merged_payload[key] = round(sum(values) / len(values), 3)

            result.append(
                {
                    "domain": last["domain"],
                    "source": last["source"],
                    # Bucket midpoint, not the last timestamp - using the
                    # end of the bucket would shift the whole series
                    # rightward by up to one bucket width.
                    "timestamp": (bucket[0]["timestamp"] + bucket[-1]["timestamp"]) / 2,
                    "payload": merged_payload,
                }
            )
        return result
