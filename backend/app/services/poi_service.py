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

import asyncio
import logging
import math
import time
from typing import Any

from app.services.configuration_service import configuration_service

import httpx

from app.db.database import SessionLocal
from app.db.models import CachedPoi, PoiFetchLog

logger = logging.getLogger("vanos.poi_service")

# POIs change on the order of months, not minutes, but the app's own
# docs and marketing copy promise "cached for 7 days" - this used to say
# 30 here, which meant an area could go stale for a month before it
# ever refreshed on its own, silently breaking that promise.
CACHE_TTL_SECONDS = 7 * 86400
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


def _build_address(tags: dict[str, str]) -> str | None:
    """OSM's structured address tags (housenumber/street/city/postcode)
    aren't present on every entry - many campsites and dump stations are
    mapped with just a location and a name. Combines whatever parts
    exist rather than requiring all of them.
    """
    if tags.get("addr:full"):
        return tags["addr:full"]

    line1 = " ".join(part for part in [tags.get("addr:housenumber"), tags.get("addr:street")] if part)
    parts = [p for p in [line1, tags.get("addr:city"), tags.get("addr:postcode")] if p]
    return ", ".join(parts) if parts else None


def _build_poi_dict(osm_id: int, category: str, latitude: float, longitude: float, tags: dict[str, str]) -> dict[str, Any]:
    return {
        "id": osm_id,
        "category": category,
        "name": tags.get("name"),
        "latitude": latitude,
        "longitude": longitude,
        "opening_hours": tags.get("opening_hours"),
        "fee": tags.get("fee"),
        "address": _build_address(tags),
        "phone": tags.get("phone") or tags.get("contact:phone"),
        "website": tags.get("website") or tags.get("contact:website"),
    }


class PoiService:
    async def search_nearby(
        self, latitude: float, longitude: float, radius_m: int, categories: list[str], force_refresh: bool = False
    ) -> dict[str, Any]:
        """Returns {"results": [...], "from_cache": bool, "cached_at": float|None}.

        Cache-first: if this area was fetched recently, answer locally
        without touching the network at all. If it wasn't, fetch and
        store. If the fetch fails (no signal, Overpass down), fall back
        to whatever is cached for the area regardless of age and say so,
        rather than showing nothing.

        `force_refresh=True` (the Nearby screen's Refresh button) skips
        the coverage check entirely and goes straight to a live fetch -
        previously there was no way to do this at all, so tapping
        Refresh inside the TTL window could never do anything other than
        hand back the exact same cached response, however many times you
        pressed it.
        """
        valid = [c for c in categories if c in POI_TAGS] or list(POI_TAGS.keys())

        # All SQLite work goes through asyncio.to_thread so it never blocks
        # the event loop (which also runs the roof safety watchdog).
        covered_at = await asyncio.to_thread(self._coverage_timestamp, latitude, longitude, radius_m)
        if not force_refresh and covered_at is not None and (time.time() - covered_at) < CACHE_TTL_SECONDS:
            return {
                "results": await asyncio.to_thread(self._from_cache, latitude, longitude, radius_m, valid),
                "from_cache": True,
                "cached_at": covered_at,
            }

        try:
            results = await self._fetch_remote(latitude, longitude, radius_m, valid)
            await asyncio.to_thread(self._store, results, latitude, longitude, radius_m)
            return {"results": results, "from_cache": False, "cached_at": None}
        except Exception as e:  # noqa: BLE001 - offline is an expected state in a van
            logger.warning("Overpass fetch failed (%s) - falling back to cache", e)
            cached = await asyncio.to_thread(self._from_cache, latitude, longitude, radius_m, valid)
            if cached or covered_at is not None:
                return {"results": cached, "from_cache": True, "cached_at": covered_at}
            raise

    def _coverage_timestamp(self, latitude: float, longitude: float, radius_m: int) -> float | None:
        """Most recent fetch that plausibly covers this point/radius.

        Pre-filters with a lat/lon bounding box so SQLite can use the
        indexes instead of scanning the whole fetch log (which grows on
        every distinct area visited), then refines with true distance in
        Python — same pattern as _from_cache.
        """
        # The box only needs to be as wide as the coverage tolerance; a
        # fetch farther than that can't cover this point regardless.
        lat_delta = COVERAGE_TOLERANCE_M / 111_000
        lon_delta = COVERAGE_TOLERANCE_M / (111_000 * max(0.01, math.cos(math.radians(latitude))))
        db = SessionLocal()
        try:
            best: float | None = None
            rows = (
                db.query(PoiFetchLog)
                .filter(
                    PoiFetchLog.radius_m >= radius_m,
                    PoiFetchLog.latitude.between(latitude - lat_delta, latitude + lat_delta),
                    PoiFetchLog.longitude.between(longitude - lon_delta, longitude + lon_delta),
                )
                .all()
            )
            for entry in rows:
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
                    "address": r.address,
                    "phone": r.phone,
                    "website": r.website,
                }
                for r in rows
                if _haversine_m(latitude, longitude, r.latitude, r.longitude) <= radius_m
            ]
        finally:
            db.close()

    def prune_cache(self) -> None:
        """Delete cache/fetch-log rows past their TTL so these tables don't
        grow forever on the SD card. Both are re-fetchable from the free
        Overpass API, so age-based eviction is lossless. Called
        periodically from the history-service maintenance loop.
        """
        cutoff = time.time() - CACHE_TTL_SECONDS
        db = SessionLocal()
        try:
            pois = db.query(CachedPoi).filter(CachedPoi.cached_at < cutoff).delete()
            logs = db.query(PoiFetchLog).filter(PoiFetchLog.fetched_at < cutoff).delete()
            db.commit()
            if pois or logs:
                logger.info("Pruned %d cached POIs and %d fetch-log rows past TTL", pois, logs)
        except Exception as e:  # noqa: BLE001 - maintenance must never crash the loop
            logger.warning("Failed to prune POI cache: %s", e)
            db.rollback()
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
                        address=r["address"],
                        phone=r["phone"],
                        website=r["website"],
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

            results.append(_build_poi_dict(element["id"], category, element["lat"], element["lon"], tags))
        return results

    async def _query_with_failover(self, query: str) -> dict[str, Any]:
        """Tries each Overpass endpoint in turn, returning the first
        success. Public Overpass instances are heavily shared and go
        down or rate-limit regularly, so a single endpoint is a single
        point of failure for the whole Nearby page.
        """
        headers = {"User-Agent": configuration_service.user_agent()}
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
