"""
PlaceService — the "Places & journal" layer of Trips & Memories (Phase 2
of the milestone; Phase 1 was the breadcrumb trail + Trips map).

Auto-detects candidate stops from the raw breadcrumb trail
(LocationHistory) by clustering consecutive points that stayed within a
small radius for a meaningful span of time - "parked a while" vs "still
driving". Detection is read-only and recomputed on demand each time
it's asked for; nothing is written until a candidate is actually named,
which is what turns it into a saved Place row.
"""

from __future__ import annotations

import math
import time
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from app.services.location_service import LocationService

# A cluster of breadcrumb points within this radius of each other counts
# as "the same spot" for stay detection.
STAY_RADIUS_METRES = 300.0
# ...and it only counts as a *stay* (not just a slow moment in traffic)
# once the first and last point in that cluster span at least this long.
MIN_STAY_MINUTES = 25.0
# A saved Place within this radius AND with an overlapping time window
# is treated as "this cluster is already journaled" rather than offered
# again as a new candidate.
DEDUPE_RADIUS_METRES = 400.0
DEDUPE_WINDOW_SECONDS = 3600.0


def _haversine_metres(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    # Mirrors location_service._haversine_metres - small enough (and
    # local enough to each module's own use) that duplicating it beats
    # reaching into another service's private helper.
    r = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


class PlaceService:
    def __init__(self, location_service: "LocationService") -> None:
        self._location_service = location_service

    # ------------------------------------------------------------------
    # Detection (read-only, computed on demand)
    # ------------------------------------------------------------------
    def detect_stays(self) -> list[dict[str, Any]]:
        """Candidate stops: consecutive breadcrumb points that stayed
        within STAY_RADIUS_METRES of each other for at least
        MIN_STAY_MINUTES, excluding any that overlap an already-saved
        Place in both space and time."""
        points = self._location_service.history(max_points=20_000)
        if len(points) < 2:
            return []

        clusters: list[dict[str, Any]] = []
        cluster_points = [points[0]]

        def flush() -> None:
            if len(cluster_points) < 2:
                return
            arrived = cluster_points[0]["timestamp"]
            departed = cluster_points[-1]["timestamp"]
            if (departed - arrived) < MIN_STAY_MINUTES * 60:
                return
            lat = sum(p["latitude"] for p in cluster_points) / len(cluster_points)
            lon = sum(p["longitude"] for p in cluster_points) / len(cluster_points)
            clusters.append(
                {
                    "latitude": lat,
                    "longitude": lon,
                    "arrived_at": arrived,
                    "departed_at": departed,
                    "point_count": len(cluster_points),
                }
            )

        for point in points[1:]:
            anchor = cluster_points[0]
            distance = _haversine_metres(anchor["latitude"], anchor["longitude"], point["latitude"], point["longitude"])
            if distance <= STAY_RADIUS_METRES:
                cluster_points.append(point)
            else:
                flush()
                cluster_points = [point]
        flush()

        existing = self.list_places()

        def already_saved(cluster: dict[str, Any]) -> bool:
            for place in existing:
                same_spot = _haversine_metres(cluster["latitude"], cluster["longitude"], place["latitude"], place["longitude"]) <= DEDUPE_RADIUS_METRES
                if not same_spot:
                    continue
                place_end = place["departed_at"] if place["departed_at"] is not None else place["arrived_at"]
                overlaps_time = not (
                    cluster["departed_at"] < place["arrived_at"] - DEDUPE_WINDOW_SECONDS
                    or cluster["arrived_at"] > place_end + DEDUPE_WINDOW_SECONDS
                )
                if overlaps_time:
                    return True
            return False

        return [c for c in clusters if not already_saved(c)]

    # ------------------------------------------------------------------
    # Saved places (CRUD)
    # ------------------------------------------------------------------
    def list_places(self) -> list[dict[str, Any]]:
        from app.db.database import SessionLocal
        from app.db.models import Place

        db = SessionLocal()
        try:
            rows = db.query(Place).order_by(Place.arrived_at.desc()).all()
            return [self._serialize(row) for row in rows]
        finally:
            db.close()

    def create_place(
        self,
        *,
        name: str,
        notes: str | None,
        latitude: float,
        longitude: float,
        arrived_at: float,
        departed_at: float | None,
    ) -> dict[str, Any]:
        from app.db.database import SessionLocal
        from app.db.models import Place

        db = SessionLocal()
        try:
            row = Place(
                name=name,
                notes=notes,
                latitude=latitude,
                longitude=longitude,
                arrived_at=arrived_at,
                departed_at=departed_at,
                created_at=time.time(),
            )
            db.add(row)
            db.commit()
            db.refresh(row)
            return self._serialize(row)
        finally:
            db.close()

    def update_place(self, place_id: int, *, name: str | None, notes: str | None) -> dict[str, Any] | None:
        from app.db.database import SessionLocal
        from app.db.models import Place

        db = SessionLocal()
        try:
            row = db.get(Place, place_id)
            if row is None:
                return None
            if name is not None:
                row.name = name
            if notes is not None:
                row.notes = notes
            db.commit()
            db.refresh(row)
            return self._serialize(row)
        finally:
            db.close()

    def delete_place(self, place_id: int) -> bool:
        from app.db.database import SessionLocal
        from app.db.models import Place

        db = SessionLocal()
        try:
            row = db.get(Place, place_id)
            if row is None:
                return False
            db.delete(row)
            db.commit()
            return True
        finally:
            db.close()

    @staticmethod
    def _serialize(row: Any) -> dict[str, Any]:
        return {
            "id": row.id,
            "name": row.name,
            "notes": row.notes,
            "latitude": row.latitude,
            "longitude": row.longitude,
            "arrived_at": row.arrived_at,
            "departed_at": row.departed_at,
            "created_at": row.created_at,
        }
