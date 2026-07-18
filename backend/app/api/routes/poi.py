"""
POI API — powers the Nearby map page. Real, open data via OpenStreetMap's
Overpass API (see poi_service.py for why, and why not Park4Night).
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.services import location_service, poi_service

router = APIRouter(prefix="/api/poi", tags=["poi"])


@router.get("/nearby")
async def get_nearby(radius_m: int = 10000, categories: str = "") -> dict:
    location = location_service.get()
    if location is None:
        raise HTTPException(status_code=404, detail="No location set - configure one in Settings → General")

    category_list = [c.strip() for c in categories.split(",") if c.strip()]

    try:
        return await poi_service.search_nearby(location["latitude"], location["longitude"], radius_m, category_list)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"POI search failed and nothing is cached for this area: {e}")
