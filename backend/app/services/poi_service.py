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
from typing import Any

import httpx

logger = logging.getLogger("vanos.poi_service")

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


class PoiService:
    async def search_nearby(self, latitude: float, longitude: float, radius_m: int, categories: list[str]) -> list[dict[str, Any]]:
        valid_categories = [c for c in categories if c in POI_TAGS]
        if not valid_categories:
            valid_categories = list(POI_TAGS.keys())

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
