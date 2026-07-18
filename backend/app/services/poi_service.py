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

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

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

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(OVERPASS_URL, data={"data": query})
            response.raise_for_status()
            data = response.json()

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

    def _categorize(self, tags: dict[str, str]) -> str | None:
        for category, (key, value) in POI_TAGS.items():
            if tags.get(key) == value:
                return category
        return None


poi_service = PoiService()
