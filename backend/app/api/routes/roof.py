"""
Roof API — hold-to-run control for the elevating roof.

Auth-gated like every relay route. This moves a physical mechanism on
a vehicle, on an app reachable from the public internet.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.routes.auth import require_app_token
from app.services.roof_service import RoofUnavailableError, roof_service

router = APIRouter(prefix="/api/roof", tags=["roof"], dependencies=[Depends(require_app_token)])


class RoofHoldRequest(BaseModel):
    direction: str


@router.get("")
async def roof_status() -> dict:
    return roof_service.status()


@router.post("/hold")
async def roof_hold(body: RoofHoldRequest) -> dict:
    """Called repeatedly (~every 500ms) while the button is held.

    Deliberately not "start" and "stop": there is no state where the
    roof keeps moving because the app stopped talking. Each request
    buys about 1.5 seconds of movement and no more.
    """
    if body.direction not in ("up", "down"):
        raise HTTPException(status_code=400, detail="direction must be 'up' or 'down'")
    try:
        return await roof_service.hold(body.direction)  # type: ignore[arg-type]
    except RoofUnavailableError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.post("/release")
async def roof_release() -> dict:
    """Sent when the button is released. The watchdog would stop the
    roof anyway within ~1.5s; this just makes the normal case immediate.
    """
    return await roof_service.release()
