"""
Location API — powers the location controls in Settings → General.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import location_service

router = APIRouter(prefix="/api/location", tags=["location"])


class GpsLocationUpdate(BaseModel):
    latitude: float
    longitude: float


@router.get("")
async def get_location() -> dict:
    location = location_service.get()
    if location is None:
        raise HTTPException(status_code=404, detail="No location set yet")
    return location


@router.post("/gps")
async def set_gps_location(body: GpsLocationUpdate) -> dict:
    return location_service.set_from_gps(body.latitude, body.longitude)


@router.post("/ip-fallback")
async def refresh_ip_location() -> dict:
    try:
        return await location_service.refresh_ip_fallback()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"IP geolocation failed: {e}")


@router.get("/history")
async def get_location_history(since: float = 0.0, max_points: int = 2000) -> dict:
    """Breadcrumb of where the van has been (GPS fixes only), oldest
    first — the data behind the Trips view."""
    points = location_service.history(since_timestamp=since, max_points=max_points)
    return {"points": points, "count": len(points)}
