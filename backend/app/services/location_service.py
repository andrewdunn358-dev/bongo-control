"""
LocationService — holds the van's current location.

Deliberately NOT a Plugin: a hardware plugin autonomously produces its
own telemetry (BLE scanning, etc.), but location here is *pushed* by
the frontend (the phone/tablet's own browser Geolocation API — real
GPS, since that's what's actually in your pocket, not new hardware) via
a REST call, not polled by the backend. A dedicated GPS module plugin
is a plausible future milestone; this covers the phone-assisted case
that works today.

Falls back to IP-based geolocation (approximate — city-level accuracy
at best, sometimes much worse on mobile carrier connections) only when
GPS hasn't been granted/isn't available. The IP lookup is deliberately
called with no target IP, so the geolocation service resolves the
*server's own* outbound public IP — i.e. the van's actual internet
connection, not whichever device happens to be viewing the dashboard
(which matters if you're checking in on it remotely later).
"""

from __future__ import annotations

import datetime
import logging
import math
import time
from typing import Any

import httpx

from app.services.configuration_service import ConfigurationService

logger = logging.getLogger("vanos.location_service")

IP_GEOLOCATION_URL = "http://ip-api.com/json/"  # free, no key, ~45 req/min

# Trip-log thresholds: only append a breadcrumb point once the van has
# moved a meaningful distance OR enough time has passed. Stops a parked
# van logging thousands of near-identical rows, while still capturing a
# gentle drift or a long stay's occasional re-fix.
HISTORY_MIN_MOVE_METRES = 50.0
HISTORY_MIN_INTERVAL_SECONDS = 600.0


def _haversine_metres(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


class LocationService:
    def __init__(self, configuration_service: ConfigurationService) -> None:
        self._config = configuration_service
        # Last breadcrumb actually written, kept in memory to apply the
        # move/time threshold cheaply. Resets on restart (the first fix
        # after a restart always logs, which is fine — it's one point).
        self._last_logged: tuple[float, float, float] | None = None

    def get(self) -> dict[str, Any] | None:
        location = self._config.get("location")
        return location if location else None

    def set_from_gps(
        self, latitude: float, longitude: float, satellites: int | None = None, hdop: float | None = None
    ) -> dict[str, Any]:
        location = {
            "latitude": latitude,
            "longitude": longitude,
            "source": "gps",
            "updated_at": time.time(),
            # Optional - only a real GPS receiver parsing an NMEA
            # sentence has these at all (the browser Geolocation API
            # doesn't expose them). Purely informational: a rough,
            # honest "how much to trust this fix" signal for the UI,
            # never used to gate whether the fix gets accepted at all -
            # a 2-satellite fix is still a real fix, just a weaker one.
            "satellites": satellites,
            "hdop": hdop,
        }
        self._config.set("location", location)
        self._maybe_log_history(latitude, longitude, "gps")
        return location

    def _maybe_log_history(self, latitude: float, longitude: float, source: str) -> None:
        """Append a breadcrumb point if the van has moved far enough or
        enough time has passed. Best-effort: a logging failure must never
        break setting the location."""
        now = time.time()
        if self._last_logged is not None:
            plat, plon, pts = self._last_logged
            moved = _haversine_metres(plat, plon, latitude, longitude)
            if moved < HISTORY_MIN_MOVE_METRES and (now - pts) < HISTORY_MIN_INTERVAL_SECONDS:
                return

        from app.db.database import SessionLocal
        from app.db.models import LocationHistory

        db = SessionLocal()
        try:
            db.add(LocationHistory(timestamp=now, latitude=latitude, longitude=longitude, source=source))
            db.commit()
            self._last_logged = (latitude, longitude, now)
        except Exception as e:  # noqa: BLE001 - never let history logging break location setting
            logger.warning("Failed to log location history: %s", e)
            db.rollback()
        finally:
            db.close()

    def history(self, since_timestamp: float = 0.0, max_points: int | None = None) -> list[dict[str, Any]]:
        """Breadcrumb points since a timestamp, oldest first. Optionally
        strided down to at most max_points so a long trail stays light to
        send to a phone — start and end points are always kept."""
        from app.db.database import SessionLocal
        from app.db.models import LocationHistory

        db = SessionLocal()
        try:
            rows = (
                db.query(LocationHistory)
                .filter(LocationHistory.timestamp >= since_timestamp)
                .order_by(LocationHistory.timestamp)
                .all()
            )
            points = [
                {"timestamp": r.timestamp, "latitude": r.latitude, "longitude": r.longitude, "source": r.source}
                for r in rows
            ]
        finally:
            db.close()

        if max_points is None or len(points) <= max_points:
            return points
        # Keep endpoints; evenly stride the middle.
        step = len(points) / max_points
        sampled = [points[min(int(i * step), len(points) - 1)] for i in range(max_points)]
        sampled[-1] = points[-1]
        return sampled

    _stats_cache: tuple | None = None

    def trip_stats(self, since_timestamp: float = 0.0) -> dict[str, Any]:
        """Distance travelled, computed on the FULL-RESOLUTION trail.

        This lives on the backend, not the frontend, because of a bug
        the numbers made obvious: /history strides its result down to
        max_points (2000) before sending, and the frontend then summed
        distance over whatever it received. Two of the three filters
        below reason about the GAP BETWEEN CONSECUTIVE POINTS, and
        striding stretches every gap by the stride factor - with 12k
        points in the table that is ~6x. Rule 3 in particular then
        rejects real driving as drift, because segments routinely
        exceed the keepalive interval for the sole reason that the
        points in between were thrown away.

        Worse, it drifted over time: as the table grows the stride
        grows, so the same journey reported a different distance every
        few days. Reported as "the miles is showing strange again".

        The three rules are ported verbatim from Trips.tsx (each one
        added in response to a real reported failure, so none is
        theoretical):

        1. 20m noise floor - a parked van still logs keepalive points
           every 600s, and their jitter summed over weeks read 15,201km
           on a van that had not moved. A genuine movement-triggered
           point is >=50m by construction, so a 20m floor can only drop
           jitter.
        2. 60 m/s (~134mph) ceiling - the receiver occasionally emits
           one badly wrong fix, creating a jump out and straight back.
           Confirmed in this van's own data: 2.2km covered in 13s, then
           back within 2m one second later.
        3. Keepalive-interval rule - a segment spanning >=90% of
           HISTORY_MIN_INTERVAL_SECONDS only exists because the van did
           NOT move 50m in that time (or a movement-triggered point
           would have fired sooner), so any distance it reports is
           drift however plausible its implied speed.
        Plus the returned-nearby check for slow drift that circles back
        on itself within 15 minutes.
        """
        # Cached on (window, newest point). Reported: the Trips page
        # "takes an age to load" - this walks every point in the table
        # (15,080 and growing) with a lookback scan on each one, and it
        # ran in full on every page load and every poll. The trail only
        # changes when a new point is logged, so the result is stable
        # between those - keying on the newest timestamp means a new
        # point invalidates it automatically and nothing goes stale.
        newest = self._newest_timestamp()
        cache_key = (since_timestamp, newest)
        if self._stats_cache and self._stats_cache[0] == cache_key:
            return self._stats_cache[1]

        points = self.history(since_timestamp=since_timestamp)
        if len(points) < 2:
            return {
                "distance_metres": 0.0, "points": len(points), "rejected": 0,
                "days": 0, "first_timestamp": None, "last_timestamp": None, "by_day": [],
            }

        RECENT_WINDOW_SECONDS = 15 * 60
        MIN_LOOKBACK_SECONDS = 120
        RETURN_THRESHOLD_METRES = 150
        NOISE_FLOOR_METRES = 20
        MAX_SPEED_MPS = 60
        KEEPALIVE_S = HISTORY_MIN_INTERVAL_SECONDS

        distance = 0.0
        rejected = 0
        recent: list[tuple[dict, float]] = []
        by_day: dict[str, float] = {}

        for i in range(1, len(points)):
            prev, cur = points[i - 1], points[i]
            segment = _haversine_metres(prev["latitude"], prev["longitude"], cur["latitude"], cur["longitude"])
            if segment < NOISE_FLOOR_METRES:
                continue
            elapsed = cur["timestamp"] - prev["timestamp"]
            if elapsed <= 0 or segment / elapsed > MAX_SPEED_MPS:
                rejected += 1
                continue
            if elapsed >= KEEPALIVE_S * 0.9:
                rejected += 1
                continue
            while recent and cur["timestamp"] - recent[0][1] > RECENT_WINDOW_SECONDS:
                recent.pop(0)
            returned_nearby = any(
                cur["timestamp"] - ts >= MIN_LOOKBACK_SECONDS
                and _haversine_metres(pt["latitude"], pt["longitude"], cur["latitude"], cur["longitude"]) < RETURN_THRESHOLD_METRES
                for pt, ts in recent
            )
            recent.append((cur, cur["timestamp"]))
            if returned_nearby:
                rejected += 1
                continue
            distance += segment
            day = datetime.datetime.fromtimestamp(cur["timestamp"]).strftime("%a %-d %b")
            by_day[day] = by_day.get(day, 0.0) + segment

        span_days = (points[-1]["timestamp"] - points[0]["timestamp"]) / 86400
        result = {
            "distance_metres": distance,
            "points": len(points),
            "rejected": rejected,
            "days": max(1, math.ceil(span_days or 0)),
            "first_timestamp": points[0]["timestamp"],
            "last_timestamp": points[-1]["timestamp"],
            "by_day": sorted(
                [{"day": d, "metres": m} for d, m in by_day.items()],
                key=lambda x: x["metres"], reverse=True,
            ),
        }
        self._stats_cache = (cache_key, result)
        return result

    def _newest_timestamp(self) -> float:
        """Cheap cache key - one indexed row, not the whole table."""
        from app.db.database import SessionLocal
        from app.db.models import LocationHistory

        db = SessionLocal()
        try:
            row = db.query(LocationHistory.timestamp).order_by(LocationHistory.timestamp.desc()).first()
            return float(row[0]) if row else 0.0
        finally:
            db.close()

    def delete_history_range(self, after: float | None = None, before: float | None = None) -> int:
        """Delete breadcrumb rows in [after, before] (either bound
        optional). For cleaning out a known-bad stretch — e.g. the first
        days after fitting a new GPS antenna, when a poor sky view or a
        cold-start fix can produce genuinely wrong positions, not just
        the small jitter the distance calc already filters. Returns the
        number of rows removed. Irreversible - the caller is expected to
        confirm with the person before calling this."""
        from app.db.database import SessionLocal
        from app.db.models import LocationHistory

        db = SessionLocal()
        try:
            q = db.query(LocationHistory)
            if after is not None:
                q = q.filter(LocationHistory.timestamp >= after)
            if before is not None:
                q = q.filter(LocationHistory.timestamp <= before)
            count = q.delete(synchronize_session=False)
            db.commit()
            return count
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    async def refresh_ip_fallback(self) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(IP_GEOLOCATION_URL, params={"fields": "status,lat,lon,city,country"})
            response.raise_for_status()
            data = response.json()

        if data.get("status") != "success":
            raise RuntimeError(f"IP geolocation failed: {data}")

        location = {
            "latitude": data["lat"],
            "longitude": data["lon"],
            "source": "ip_approximate",
            "city": data.get("city"),
            "country": data.get("country"),
            "updated_at": time.time(),
        }
        self._config.set("location", location)
        return location
