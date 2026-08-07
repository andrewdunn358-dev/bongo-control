"""
Relay API — switching 12V circuits.

Auth-gated in full (unlike the AI routes, where only the expensive
endpoint is protected and a harmless status check is left open): every
route here either reveals or changes the state of physical circuits in
the van, on an app that's reachable from the public internet via the
Cloudflare Tunnel.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.api.routes.auth import require_app_token
from app.services.relay_service import RelayUnavailableError, relay_service
from app.services.roof_service import roof_service

router = APIRouter(prefix="/api/relays", tags=["relays"], dependencies=[Depends(require_app_token)])

_ROOF_TOGGLE_MESSAGE = (
    "This relay is the roof reversing bridge - it only moves via hold-to-run "
    "on the Roof screen, which has a watchdog and a direction interlock that "
    "a plain switch here does not. Use /roof, not /relays, for this channel."
)


class RelayRenameRequest(BaseModel):
    name: str


class RelaySetRequest(BaseModel):
    on: bool


@router.get("")
async def list_relays() -> dict:
    return relay_service.status()


@router.post("/{channel_id}/set")
async def set_relay(channel_id: int, body: RelaySetRequest) -> dict:
    # Turning a roof channel OFF is always safe - it's the same
    # de-energise-both-leads action RoofService itself performs to stop
    # and brake the motor - so only an attempt to turn one ON is
    # refused here.
    if body.on and channel_id in roof_service.managed_channel_ids:
        raise HTTPException(status_code=409, detail=_ROOF_TOGGLE_MESSAGE)
    try:
        return relay_service.set(channel_id, body.on, source="app:switches")
    except RelayUnavailableError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/{channel_id}/toggle")
async def toggle_relay(channel_id: int) -> dict:
    # Toggle can't tell in advance whether it lands on ON, so it's
    # blocked outright for roof channels - see set_relay above.
    if channel_id in roof_service.managed_channel_ids:
        raise HTTPException(status_code=409, detail=_ROOF_TOGGLE_MESSAGE)
    try:
        return relay_service.toggle(channel_id, source="app:switches")
    except RelayUnavailableError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/all-off")
async def all_off() -> dict:
    """Panic switch - useful if something's been left on, and a
    reasonable thing to reach for before leaving the van.
    """
    try:
        return relay_service.all_off(source="app:all-off")
    except RelayUnavailableError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.put("/{channel_id}/name")
async def rename_relay(channel_id: int, body: RelayRenameRequest) -> dict:
    """Rename a channel - "Relay 2" means nothing once it's wired to
    something real. Takes effect immediately, no restart.
    """
    try:
        return relay_service.rename(channel_id, body.name)
    except RelayUnavailableError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/events")
def get_relay_events(
    limit: int = Query(default=100, gt=0, le=1000),
    before: float | None = Query(default=None),
) -> dict:
    """Durable audit trail - every relay/roof event, newest first, with
    its source (what actually caused it). The fix for the exact gap
    that turned one night's mystery relay activity into an hours-long
    investigation: this used to only live in Docker's own stdout log,
    which rotates away on every rebuild. Sync `def` so the SQLite read
    runs in the threadpool, not on the event loop, same convention as
    the other history-style reads in this app (e.g. location history).
    `before` pages backward through older events (pass the oldest
    timestamp from the previous page).
    """
    from app.db.database import SessionLocal
    from app.db.models import RelayEvent

    db = SessionLocal()
    try:
        q = db.query(RelayEvent).order_by(RelayEvent.timestamp.desc())
        if before is not None:
            q = q.filter(RelayEvent.timestamp < before)
        rows = q.limit(limit).all()
        return {
            "events": [
                {
                    "id": r.id,
                    "timestamp": r.timestamp,
                    "channel_id": r.channel_id,
                    "channel_name": r.channel_name,
                    "action": r.action,
                    "detail": r.detail,
                    "source": r.source,
                }
                for r in rows
            ],
            "count": len(rows),
        }
    finally:
        db.close()
