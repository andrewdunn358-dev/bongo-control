"""
LocationService — holds the van's current location and its breadcrumb
trail.

TWO kinds of position arrive here, and they are NOT equal:

  * VAN GPS - the USB receiver (gps_serial plugin) calls set_from_gps().
    This is the only source that may write to location_history, the
    trail behind the Trips screen.
  * DEVICE - the phone/tablet browser (useAutoLocate) or a coordinate
    typed into Settings, via set_from_device(). It can set the CURRENT
    location (weather, nearby, solar) when the receiver has no fresh fix,
    but it never writes to the trail.

Why the split (Oct 2026): originally the phone WAS the GPS, so the
browser posted to the same endpoint the receiver later used, and both
were stored as source="gps". Once the receiver was fitted, opening the
dashboard on a phone away from the van wrote the PHONE's position into
the van's trail - the map drew long straight lines between the van and
wherever the phone was, and both legs of each hop were counted as miles.

Falls back to IP-based geolocation (approximate — city-level accuracy
at best) only when nothing better is available. The IP lookup resolves
the *server's own* outbound public IP — the van's connection, not the
viewing device's. IP positions never enter the trail either.
"""

from __future__ import annotations

import datetime
import logging
import math
import threading
import time
from collections import deque
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

# A van GPS fix younger than this wins over a phone/tablet position. The
# receiver reports every ~1-2s while it has a fix, so 2 minutes of
# silence means it has genuinely lost the sky (or been unplugged).
VAN_FIX_FRESH_SECONDS = 120.0

# --- Trail filter rules (the ONE implementation - see TrailWalker) ---
NOISE_FLOOR_METRES = 20.0
MAX_SPEED_MPS = 60.0
KEEPALIVE_FRACTION = 0.9
RECENT_WINDOW_SECONDS = 15 * 60
MIN_LOOKBACK_SECONDS = 120
RETURN_THRESHOLD_METRES = 150.0
# Grid cells for the returned-nearby search. Must be >= the 150m return
# threshold in BOTH directions so a 3x3 neighbourhood is guaranteed to
# contain every point within range: 0.0014 deg lat ~ 155m; 0.003 deg lon
# is >= 150m anywhere south of ~63N, i.e. the whole UK.
_CELL_LAT = 0.0014
_CELL_LON = 0.003

try:
    from zoneinfo import ZoneInfo

    _UK = ZoneInfo("Europe/London")
except Exception:  # noqa: BLE001 - slim image without tzdata: fall back to container local time
    _UK = None


def _haversine_metres(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _day_label(ts: float) -> str:
    dt = datetime.datetime.fromtimestamp(ts, _UK) if _UK else datetime.datetime.fromtimestamp(ts)
    return dt.strftime("%a %-d %b")


class TrailWalker:
    """Walks the van's breadcrumb trail oldest-first and decides, segment
    by segment, what counts as real travel. The SINGLE authority for
    both the mileage and the line drawn on the map - previously the
    backend implemented one rule and Trips.tsx four, and the map drew
    every raw point regardless, so the three never agreed.

    Streaming by design: feed() can be called again with only the newer
    points and carries every piece of state across, so a page load after
    the first is a handful of points, not the whole table (the Pi 2B
    took 14s to rewalk 15k points per request before this was
    incremental).

    The rules, in order - each was added for a real reported failure,
    see the git history of Trips.tsx for the cases:
      1. Noise floor: a segment under 20m is parked jitter. Not counted,
         not a rejection, does not break the drawn line.
      2. Speed ceiling: non-positive elapsed time, or over 60 m/s
         (~134mph) - a teleport fix. Rejected.
      3. Keepalive drift: a segment spanning >= 90% of the 600s logging
         keepalive only exists because the van did NOT move 50m in that
         time, so whatever distance it shows is drift. Rejected.
      4. Returned nearby: the new point lands within 150m of somewhere
         the trail was between 2 and 15 minutes ago - parked drift
         wandering out and back. The 2-minute minimum lookback matters:
         without it, ordinary curving roads (points 50-150m apart) look
         like returns and a real 14.5mi drive read as 1.24mi. Rejected.
    Any rejection breaks the drawn line, so a bad hop is never drawn.
    """

    def __init__(self) -> None:
        self.distance = 0.0
        self.rejected = 0
        self.by_day: dict[str, float] = {}
        self.prev: tuple[float, float, float] | None = None  # (ts, lat, lon)
        self.first_ts: float | None = None
        self.last_ts: float | None = None
        self.fed = 0  # rows consumed - compared against the table to catch edits/deletes
        self.ts_sum = 0.0  # sum of timestamps consumed, for the same check
        self._recent: deque[tuple[float, float, float, tuple[int, int]]] = deque()
        self._grid: dict[tuple[int, int], deque[tuple[float, float, float]]] = {}
        self.runs: list[list[tuple[float, float, float]]] = []
        self._broken = True  # next accepted segment starts a new drawn run

    @staticmethod
    def _cell(lat: float, lon: float) -> tuple[int, int]:
        return (math.floor(lat / _CELL_LAT), math.floor(lon / _CELL_LON))

    def _returned_nearby(self, ts: float, lat: float, lon: float) -> bool:
        while self._recent and ts - self._recent[0][0] > RECENT_WINDOW_SECONDS:
            _, _, _, cell = self._recent.popleft()
            bucket = self._grid.get(cell)
            if bucket:
                bucket.popleft()  # cells fill in time order, so the oldest is first
                if not bucket:
                    del self._grid[cell]
        ci, cj = self._cell(lat, lon)
        hit = False
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                for rts, rlat, rlon in self._grid.get((ci + di, cj + dj), ()):
                    if ts - rts >= MIN_LOOKBACK_SECONDS and _haversine_metres(rlat, rlon, lat, lon) < RETURN_THRESHOLD_METRES:
                        hit = True
                        break
                if hit:
                    break
            if hit:
                break
        # Every point that reaches this rule is remembered, counted or
        # not, so a run of drift can still be recognised as "back again".
        cell = (ci, cj)
        self._recent.append((ts, lat, lon, cell))
        self._grid.setdefault(cell, deque()).append((ts, lat, lon))
        return hit

    def feed(self, rows: list[tuple[float, float, float]]) -> None:
        """rows: (timestamp, latitude, longitude), oldest first, all newer
        than anything fed before."""
        keepalive = HISTORY_MIN_INTERVAL_SECONDS * KEEPALIVE_FRACTION
        for cur in rows:
            self.fed += 1
            self.ts_sum += cur[0]
            if self.first_ts is None:
                self.first_ts = cur[0]
            self.last_ts = cur[0]
            prev, self.prev = self.prev, cur
            if prev is None:
                continue
            ts, lat, lon = cur
            segment = _haversine_metres(prev[1], prev[2], lat, lon)
            if segment < NOISE_FLOOR_METRES:
                continue
            elapsed = ts - prev[0]
            if elapsed <= 0 or segment / elapsed > MAX_SPEED_MPS or elapsed >= keepalive:
                self.rejected += 1
                self._broken = True
                continue
            if self._returned_nearby(ts, lat, lon):
                self.rejected += 1
                self._broken = True
                continue
            self.distance += segment
            day = _day_label(ts)
            self.by_day[day] = self.by_day.get(day, 0.0) + segment
            if self._broken or not self.runs:
                self.runs.append([prev, cur])
                self._broken = False
            else:
                run = self.runs[-1]
                if run[-1] is not prev:
                    run.append(prev)  # bridge over noise-floor jitter only
                run.append(cur)

    def stats(self) -> dict[str, Any]:
        span_days = ((self.last_ts or 0) - (self.first_ts or 0)) / 86400
        return {
            "distance_metres": self.distance,
            "points": self.fed,
            "rejected": self.rejected,
            "days": max(1, math.ceil(span_days)) if self.fed else 0,
            "first_timestamp": self.first_ts,
            "last_timestamp": self.last_ts,
            "by_day": sorted(
                [{"day": d, "metres": m} for d, m in self.by_day.items()],
                key=lambda x: x["metres"], reverse=True,
            ),
        }

    def trail(self, max_points: int) -> list[list[list[float]]]:
        """The accepted trail as separate runs, for drawing. Decimated
        ONLY here, after distance was already computed at full resolution;
        each run keeps its own first and last point."""
        runs = [r for r in self.runs if len(r) >= 2]
        total = sum(len(r) for r in runs)
        if total <= max_points:
            return [[[p[0], p[1], p[2]] for p in r] for r in runs]
        out = []
        for r in runs:
            keep = max(2, round(len(r) * max_points / total))
            if keep >= len(r):
                picked = r
            else:
                step = (len(r) - 1) / (keep - 1)
                picked = [r[round(i * step)] for i in range(keep)]
            out.append([[p[0], p[1], p[2]] for p in picked])
        return out


class LocationService:
    _MAX_WINDOWS = 4  # "this trip", "all time", plus a little slack

    def __init__(self, configuration_service: ConfigurationService) -> None:
        self._config = configuration_service
        # Last breadcrumb actually written, kept in memory to apply the
        # move/time threshold cheaply. Resets on restart (the first fix
        # after a restart always logs, which is fine — it's one point).
        self._last_logged: tuple[float, float, float] | None = None
        self._last_van_fix_at: float | None = None
        self._walkers: dict[float, TrailWalker] = {}
        self._walk_lock = threading.Lock()

    def get(self) -> dict[str, Any] | None:
        location = self._config.get("location")
        return location if location else None

    def van_fix_is_fresh(self) -> bool:
        return self._last_van_fix_at is not None and (time.time() - self._last_van_fix_at) < VAN_FIX_FRESH_SECONDS

    def set_from_gps(
        self, latitude: float, longitude: float, satellites: int | None = None, hdop: float | None = None
    ) -> dict[str, Any]:
        """VAN RECEIVER ONLY - called by the gps_serial plugin, never by
        an HTTP endpoint. The only path that writes the trail."""
        now = time.time()
        self._last_van_fix_at = now
        location = {
            "latitude": latitude,
            "longitude": longitude,
            "source": "gps",
            "updated_at": now,
            # Purely informational: a rough, honest "how much to trust
            # this fix" signal for the UI, never used to gate the fix.
            "satellites": satellites,
            "hdop": hdop,
        }
        self._config.set("location", location)
        self._maybe_log_history(latitude, longitude, "gps")
        return location

    def set_from_device(self, latitude: float, longitude: float, manual: bool = False) -> dict[str, Any]:
        """A phone/tablet browser position, or coordinates typed into
        Settings. Sets the CURRENT location only - never the trail.

        An automatic device update is ignored while the van receiver has
        a fresh fix: the receiver is where the van actually is, the
        phone may be miles away. A manual entry is an explicit choice so
        it is applied, though a live receiver will replace it within
        seconds."""
        if not manual and self.van_fix_is_fresh():
            current = self.get() or {}
            return {**current, "applied": False}
        location = {
            "latitude": latitude,
            "longitude": longitude,
            "source": "manual" if manual else "device",
            "updated_at": time.time(),
        }
        self._config.set("location", location)
        return {**location, "applied": True}

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
            # COLUMNS, not entities. db.query(LocationHistory) builds a
            # full ORM object per row - identity map, change tracking,
            # instance state - and every one of those is then thrown
            # away into a plain dict. Measured on the Pi with 18,931
            # rows: 4,088 ms. Selecting the four columns returns plain
            # tuples and skips all of it.
            #
            # This was the actual cause of the Trips page taking 13
            # seconds, after several wrong guesses at the distance
            # maths, the cache strategy and the auth path - none of
            # which were ever the bottleneck.
            rows = (
                db.query(
                    LocationHistory.timestamp,
                    LocationHistory.latitude,
                    LocationHistory.longitude,
                    LocationHistory.source,
                )
                .filter(LocationHistory.timestamp >= since_timestamp)
                .order_by(LocationHistory.timestamp)
                .all()
            )
            points = [
                {"timestamp": ts, "latitude": la, "longitude": lo, "source": src}
                for ts, la, lo, src in rows
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

    def _van_rows(self, since_timestamp: float) -> list[tuple[float, float, float]]:
        """(ts, lat, lon) for van-receiver rows only, oldest first. Columns,
        not ORM entities - see history() for why that matters on the Pi."""
        from app.db.database import SessionLocal
        from app.db.models import LocationHistory

        db = SessionLocal()
        try:
            return [
                (ts, la, lo)
                for ts, la, lo in db.query(LocationHistory.timestamp, LocationHistory.latitude, LocationHistory.longitude)
                .filter(LocationHistory.timestamp > since_timestamp, LocationHistory.source == "gps")
                .order_by(LocationHistory.timestamp)
                .all()
            ]
        finally:
            db.close()

    def _walker(self, since_timestamp: float) -> TrailWalker:
        """The up-to-date TrailWalker for a window, built incrementally.

        Rebuilt from scratch unless the table is exactly what was fed plus
        what's new: same row count AND same sum of timestamps. Count alone
        misses a delete plus an insert (and SQLite reuses row ids, so the
        highest id doesn't help). Together they catch the cleanup control,
        back-dated inserts and edits, from one aggregate query. Bounded to a few windows so moving the trip marker about
        can't grow memory without limit. Locked: two page loads at once
        must not feed the same walker twice."""
        with self._walk_lock:
            walker = self._walkers.get(since_timestamp)
            if walker is not None:
                fresh = self._van_rows(walker.last_ts if walker.last_ts is not None else since_timestamp - 1e-6)
                count, ts_sum = self._count_points(since_timestamp)
                expected = walker.ts_sum + sum(r[0] for r in fresh)
                if walker.fed + len(fresh) == count and abs(expected - ts_sum) < 1e-3 * max(1, count):
                    walker.feed(fresh)
                    return walker
            walker = TrailWalker()
            walker.feed(self._van_rows(since_timestamp - 1e-6))
            self._walkers.pop(since_timestamp, None)
            self._walkers[since_timestamp] = walker
            while len(self._walkers) > self._MAX_WINDOWS:
                self._walkers.pop(next(iter(self._walkers)))
            return walker

    def trip_stats(self, since_timestamp: float = 0.0) -> dict[str, Any]:
        """Distance travelled since a timestamp, from the full-resolution
        van trail. See TrailWalker for the rules."""
        return self._walker(since_timestamp).stats()

    def trail(self, since_timestamp: float = 0.0, max_points: int = 2000) -> dict[str, Any]:
        """The SAME accepted segments that make up trip_stats' distance,
        as drawable runs of [ts, lat, lon]. The map and the mileage come
        from one walk, so they can no longer disagree."""
        walker = self._walker(since_timestamp)
        runs = walker.trail(max_points)
        return {"runs": runs, "drawn_points": sum(len(r) for r in runs), **walker.stats()}

    def _count_points(self, since_timestamp: float = 0.0) -> tuple[int, float]:
        """(row count, sum of timestamps) of van rows in the window - one
        cheap aggregate query."""
        from app.db.database import SessionLocal
        from app.db.models import LocationHistory

        db = SessionLocal()
        try:
            from sqlalchemy import func

            q = db.query(func.count(LocationHistory.id), func.sum(LocationHistory.timestamp)).filter(LocationHistory.source == "gps")
            if since_timestamp:
                q = q.filter(LocationHistory.timestamp >= since_timestamp)
            count, ts_sum = q.one()
            return int(count or 0), float(ts_sum or 0.0)
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
