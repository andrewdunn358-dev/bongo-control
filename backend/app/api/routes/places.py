"""
Places API — Trips & Memories Phase 2: named, journaled stops layered
on top of the raw breadcrumb trail from /api/location/history.

Gated the same as /api/location: these are derived straight from GPS
history, so they carry the same physical-safety sensitivity (where the
van parks and sleeps) even once a stop has a friendly name on it.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.routes.auth import require_app_token
from app.services import place_service

router = APIRouter(prefix="/api/places", tags=["places"], dependencies=[Depends(require_app_token)])


class PlaceCreate(BaseModel):
    name: str
    notes: str | None = None
    latitude: float
    longitude: float
    arrived_at: float
    departed_at: float | None = None


class PlaceUpdate(BaseModel):
    name: str | None = None
    notes: str | None = None


@router.get("")
def list_places() -> dict:
    return {"places": place_service.list_places()}


@router.get("/detected")
def list_detected() -> dict:
    """Candidate stops found in the breadcrumb trail that aren't a saved
    Place yet — the "name this stop" queue for the Trips screen."""
    return {"candidates": place_service.detect_stays()}


@router.post("")
def create_place(body: PlaceCreate) -> dict:
    name = body.name.strip() or "Unnamed stop"
    return place_service.create_place(
        name=name,
        notes=body.notes,
        latitude=body.latitude,
        longitude=body.longitude,
        arrived_at=body.arrived_at,
        departed_at=body.departed_at,
    )


@router.put("/{place_id}")
def update_place(place_id: int, body: PlaceUpdate) -> dict:
    result = place_service.update_place(place_id, name=body.name, notes=body.notes)
    if result is None:
        raise HTTPException(status_code=404, detail="Place not found")
    return result


@router.delete("/{place_id}")
def delete_place(place_id: int) -> dict:
    ok = place_service.delete_place(place_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Place not found")
    return {"ok": True}
