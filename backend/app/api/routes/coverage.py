"""
Coverage API — predicted mobile signal for somewhere you're planning to
go (see coverage_service.py for why this is a plan-ahead feature and not
a live one).

Gated, for two reasons. It spends a metered third-party quota, and it
takes an arbitrary search string — neither of which should be reachable
by anyone who finds the tunnel hostname.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.routes.auth import require_app_token
from app.services import location_service
from app.services.coverage_service import CoverageError, coverage_service

router = APIRouter(prefix="/api/coverage", tags=["coverage"], dependencies=[Depends(require_app_token)])


@router.get("/status")
async def status() -> dict:
    """Whether a key is configured + which network gets top billing.
    Lets the UI show a "set your key" prompt instead of an error."""
    return coverage_service.status()


@router.get("/search")
async def search(q: str = Query(..., min_length=1, max_length=120), force_refresh: bool = False) -> dict:
    """Place name or postcode -> coverage. The main entry point."""
    try:
        return await coverage_service.lookup(q, force_refresh=force_refresh)
    except CoverageError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Coverage lookup failed: {e}") from e


@router.get("/at")
async def at_point(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    force_refresh: bool = False,
) -> dict:
    """Coverage for a coordinate — a dropped pin, or a POI on Nearby."""
    try:
        return await coverage_service.lookup_point(lat, lon, force_refresh=force_refresh)
    except CoverageError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Coverage lookup failed: {e}") from e


@router.get("/here")
async def at_van() -> dict:
    """Coverage where the van currently is — a sanity check on the
    prediction, since you can compare it against the bars you actually
    have while you're stood there."""
    location = location_service.get()
    if location is None:
        raise HTTPException(status_code=404, detail="No location set - configure one in Settings")
    try:
        return await coverage_service.lookup_point(location["latitude"], location["longitude"])
    except CoverageError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Coverage lookup failed: {e}") from e


@router.get("/recent")
async def recent(limit: int = Query(12, gt=0, le=50)) -> dict:
    """Everything already cached, newest first — this is what the page
    shows with no internet at all."""
    import asyncio

    results = await asyncio.to_thread(coverage_service.recent, limit)
    return {"results": results, "count": len(results)}


@router.get("/area")
async def area(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius_m: int = Query(1500, gt=0, le=2000),
    limit: int = Query(40, gt=0, le=100),
) -> dict:
    """Coverage for a grid of real postcodes around a point — "what's it
    like around here", for wherever the map is centred, not just the
    van's own location. See coverage_service.area() for why this is a
    grid of points rather than a blurred heatmap."""
    try:
        return await coverage_service.area(lat, lon, radius_m=radius_m, limit=limit)
    except CoverageError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Area coverage scan failed: {e}") from e
