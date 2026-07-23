"""
Relay API — switching 12V circuits.

Auth-gated in full (unlike the AI routes, where only the expensive
endpoint is protected and a harmless status check is left open): every
route here either reveals or changes the state of physical circuits in
the van, on an app that's reachable from the public internet via the
Cloudflare Tunnel.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.routes.auth import require_app_token
from app.services.relay_service import RelayUnavailableError, relay_service

router = APIRouter(prefix="/api/relays", tags=["relays"], dependencies=[Depends(require_app_token)])


class RelayRenameRequest(BaseModel):
    name: str


class RelaySetRequest(BaseModel):
    on: bool


@router.get("")
async def list_relays() -> dict:
    return relay_service.status()


@router.post("/{channel_id}/set")
async def set_relay(channel_id: int, body: RelaySetRequest) -> dict:
    try:
        return relay_service.set(channel_id, body.on)
    except RelayUnavailableError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/{channel_id}/toggle")
async def toggle_relay(channel_id: int) -> dict:
    try:
        return relay_service.toggle(channel_id)
    except RelayUnavailableError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/all-off")
async def all_off() -> dict:
    """Panic switch - useful if something's been left on, and a
    reasonable thing to reach for before leaving the van.
    """
    try:
        return relay_service.all_off()
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
