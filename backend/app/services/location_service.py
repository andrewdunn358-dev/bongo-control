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

    def set_from_gps(self, latitude: float, longitude: float) -> dict[str, Any]:
        location = {
            "latitude": latitude,
            "longitude": longitude,
            "source": "gps",
            "updated_at": time.time(),
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
