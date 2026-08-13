"""
Radio Directory API — search the Radio Browser public directory for
streamable UK internet radio stations.

Auth-gated for consistency with every other route reachable via the
tunnel, same as coverage.py - even though this specific endpoint is a
read-only pass-through to a free public API with no per-user quota to
protect, unlike Ofcom's metered key.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.routes.auth import require_app_token
from app.services.radio_directory_service import RadioDirectoryUnavailableError, radio_directory_service

router = APIRouter(prefix="/api/radio-directory", tags=["radio-directory"], dependencies=[Depends(require_app_token)])


@router.get("/search")
async def search(
    q: str | None = Query(default=None),
    country: str = Query(default="GB", min_length=2, max_length=2),
    limit: int = Query(default=60, gt=0, le=200),
) -> dict:
    try:
        stations = await radio_directory_service.search(query=q, country_code=country.upper(), limit=limit)
    except RadioDirectoryUnavailableError as e:
        raise HTTPException(status_code=503, detail=str(e))
    return {"stations": stations, "count": len(stations)}


@router.post("/click/{station_uuid}")
async def register_click(station_uuid: str) -> dict:
    """Fire-and-forget courtesy call - see register_click()'s docstring.
    Always returns ok, even if the underlying call failed, since this
    is bookkeeping for Radio Browser's own stats, not something the
    frontend needs to react to either way.
    """
    await radio_directory_service.register_click(station_uuid)
    return {"ok": True}
