"""
PoiService — nearby points of interest via OpenStreetMap's Overpass API.

Free, no API key, genuinely open data (ODbL) — chosen deliberately over
Park4Night's crowdsourced database, which has no public API (verified;
see docs and commit history for why building on their unofficial
endpoints was ruled out).

Only queries `node`s (not ways/relations) — covers the large majority
of the point-amenity types relevant here (campsites, dump stations,
water points, fuel, supermarkets are almost always mapped as nodes),
trading a small amount of completeness for a much simpler query/parse.
"""

from __future__ import annotations

import logging
import math
import time
from typing import Any

import httpx

from app.db.database import SessionLocal
from app.db.models import CachedPoi, PoiFetchLog

logger = logging.getLogger("vanos.poi_service")

# POIs change on the order of months, not minutes - a long TTL keeps
# the free public Overpass instances from being hammered and means the
# van usually answers from local data instantly.
CACHE_TTL_SECONDS = 30 * 86400
# How far the van can move from a previously-fetched point before that
# fetch no longer counts as covering the current position.
COVERAGE_TOLERANCE_M = 3000

# overpass-api.de began requiring a descriptive User-Agent around April
# 2026 and returns 406 Not Acceptable without one - a generic library
# default like "python-httpx/0.27.2" is rejected. It's also frequently
# overloaded, so we fail over to a well-known mirror rather than giving
# up on the first error.
OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

USER_AGENT = "BongoControl/1.0 (campervan telemetry dashboard; https://github.com/andrewdunn358-dev/bongo-control)"

# OSM tag -> our category label. "sanitary_dump_station" is the real,
# correct OSM tag for what UK campervanners call an "Elsan point"
# (chemical toilet waste disposal).
POI_TAGS: dict[str, tuple[str, str]] = {
    "campsite": ("tourism", "camp_site"),
    "caravan_site": ("tourism", "caravan_site"),
    "dump_station": ("amenity", "sanitary_dump_station"),
    "water": ("amenity", "drinking_water"),
    "supermarket": ("shop", "supermarket"),
    "fuel": ("amenity", "fuel"),
}


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


class PoiService:
    async def search_nearby(
        self, latitude: float, longitude: float, radius_m: int, categories: list[str]
    ) -> dict[str, Any]:
        """Returns {"results": [...], "from_cache": bool, "cached_at": float|None}.

        Cache-first: if this area was fetched recently, answer locally
        without touching the network at all. If it wasn't, fetch and
        store. If the fetch fails (no signal, Overpass down), fall back
        to whatever is cached for the area regardless of age and say so,
        rather than showing nothing.
        """
        valid = [c for c in categories if c in POI_TAGS] or list(POI_TAGS.keys())

        covered_at = self._coverage_timestamp(latitude, longitude, radius_m)
        if covered_at is not None and (time.time() - covered_at) < CACHE_TTL_SECONDS:
            return {
                "results": self._from_cache(latitude, longitude, radius_m, valid),
                "from_cache": True,
                "cached_at": covered_at,
            }

        try:
            results = await self._fetch_remote(latitude, longitude, radius_m, valid)
            self._store(results, latitude, longitude, radius_m)
            return {"results": results, "from_cache": False, "cached_at": None}
        except Exception as e:  # noqa: BLE001 - offline is an expected state in a van
            logger.warning("Overpass fetch failed (%s) - falling back to cache", e)
            cached = self._from_cache(latitude, longitude, radius_m, valid)
            if cached or covered_at is not None:
                return {"results": cached, "from_cache": True, "cached_at": covered_at}
            raise

    def _coverage_timestamp(self, latitude: float, longitude: float, radius_m: int) -> float | None:
        """Most recent fetch that plausibly covers this point/radius."""
        db = SessionLocal()
        try:
            best: float | None = None
            for entry in db.query(PoiFetchLog).filter(PoiFetchLog.radius_m >= radius_m).all():
                if _haversine_m(latitude, longitude, entry.latitude, entry.longitude) <= COVERAGE_TOLERANCE_M:
                    if best is None or entry.fetched_at > best:
                        best = entry.fetched_at
            return best
        finally:
            db.close()

    def _from_cache(self, latitude: float, longitude: float, radius_m: int, categories: list[str]) -> list[dict[str, Any]]:
        # Pre-filter with a bounding box so SQLite can use the lat/lon
        # indexes, then refine with true distance in Python.
        lat_delta = radius_m / 111_000
        lon_delta = radius_m / (111_000 * max(0.01, math.cos(math.radians(latitude))))
        db = SessionLocal()
        try:
            rows = (
                db.query(CachedPoi)
                .filter(
                    CachedPoi.category.in_(categories),
                    CachedPoi.latitude.between(latitude - lat_delta, latitude + lat_delta),
                    CachedPoi.longitude.between(longitude - lon_delta, longitude + lon_delta),
                )
                .all()
            )
            return [
                {
                    "id": r.osm_id,
                    "category": r.category,
                    "name": r.name,
                    "latitude": r.latitude,
                    "longitude": r.longitude,
                    "opening_hours": r.opening_hours,
                    "fee": r.fee,
                }
                for r in rows
                if _haversine_m(latitude, longitude, r.latitude, r.longitude) <= radius_m
            ]
        finally:
            db.close()

    def _store(self, results: list[dict[str, Any]], latitude: float, longitude: float, radius_m: int) -> None:
        now = time.time()
        db = SessionLocal()
        try:
            for r in results:
                db.merge(
                    CachedPoi(
                        osm_id=r["id"],
                        category=r["category"],
                        name=r["name"],
                        latitude=r["latitude"],
                        longitude=r["longitude"],
                        opening_hours=r["opening_hours"],
                        fee=r["fee"],
                        cached_at=now,
                    )
                )
            db.add(PoiFetchLog(latitude=latitude, longitude=longitude, radius_m=radius_m, fetched_at=now))
            db.commit()
        except Exception as e:  # noqa: BLE001 - caching is best-effort, never fatal
            logger.warning("Failed to cache POIs: %s", e)
            db.rollback()
        finally:
            db.close()

    async def _fetch_remote(self, latitude: float, longitude: float, radius_m: int, categories: list[str]) -> list[dict[str, Any]]:
        valid_categories = categories

        clauses = "\n".join(
            f'  node["{key}"="{value}"](around:{radius_m},{latitude},{longitude});'
            for category in valid_categories
            for key, value in [POI_TAGS[category]]
        )
        query = f"[out:json][timeout:25];\n(\n{clauses}\n);\nout body;"

        data = await self._query_with_failover(query)

        results = []
        for element in data.get("elements", []):
            tags = element.get("tags", {})
            category = self._categorize(tags)
            if category is None:
                continue
            # Overpass bounds results server-side via (around:...), but
            # filter here too so the live path and the cache path apply
            # identical distance rules - otherwise an unexpected response
            # could put POIs on the map that a later cached query drops.
            if _haversine_m(latitude, longitude, element["lat"], element["lon"]) > radius_m:
                continue

            results.append(
                {
                    "id": element["id"],
                    "category": category,
                    "name": tags.get("name"),
                    "latitude": element["lat"],
                    "longitude": element["lon"],
                    "opening_hours": tags.get("opening_hours"),
                    "fee": tags.get("fee"),
                }
            )
        return results

    async def _query_with_failover(self, query: str) -> dict[str, Any]:
        """Tries each Overpass endpoint in turn, returning the first
        success. Public Overpass instances are heavily shared and go
        down or rate-limit regularly, so a single endpoint is a single
        point of failure for the whole Nearby page.
        """
        headers = {"User-Agent": USER_AGENT}
        errors: list[str] = []

        async with httpx.AsyncClient(timeout=30.0, headers=headers) as client:
            for endpoint in OVERPASS_ENDPOINTS:
                try:
                    response = await client.post(endpoint, data={"data": query})
                    response.raise_for_status()
                    return response.json()
                except Exception as e:  # noqa: BLE001 - try the next mirror
                    logger.warning("Overpass endpoint %s failed: %s", endpoint, e)
                    errors.append(f"{endpoint}: {e}")

        raise RuntimeError("All Overpass endpoints failed - " + "; ".join(errors))

    def _categorize(self, tags: dict[str, str]) -> str | None:
        for category, (key, value) in POI_TAGS.items():
            if tags.get(key) == value:
                return category
        return None


poi_service = PoiService()
