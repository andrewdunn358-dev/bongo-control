"""
Location API — powers the location controls in Settings → General.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.api.routes.auth import require_app_token
from app.plugins.manager import PluginManager
from app.services import location_service
from app.services.configuration_service import configuration_service

# Gated: the breadcrumb history reveals where the van parks and sleeps —
# a physical-safety leak — and the GPS setter lets a caller move the van's
# reported position. Treated as at least as sensitive as the camera.
router = APIRouter(prefix="/api/location", tags=["location"], dependencies=[Depends(require_app_token)])

# Set by main.py at startup, same pattern as plugins.py - avoids a
# circular import with the manager needing services main.py wires
# together first.
_manager: PluginManager | None = None


def set_manager(manager: PluginManager) -> None:
    global _manager
    _manager = manager


class GpsLocationUpdate(BaseModel):
    latitude: float
    longitude: float


# Sync `def` handlers deliberately: they touch SQLite, so FastAPI runs
# them in its threadpool instead of blocking the event loop (which also
# hosts the roof safety watchdog).
@router.get("")
def get_location() -> dict:
    location = location_service.get()
    if location is None:
        raise HTTPException(status_code=404, detail="No location set yet")
    return location


@router.post("/gps")
def set_gps_location(body: GpsLocationUpdate) -> dict:
    return location_service.set_from_gps(body.latitude, body.longitude)


@router.post("/ip-fallback")
async def refresh_ip_location() -> dict:
    try:
        return await location_service.refresh_ip_fallback()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"IP geolocation failed: {e}")


@router.get("/history")
def get_location_history(
    since: float = Query(default=0.0, ge=0),
    max_points: int = Query(default=2000, gt=0, le=20000),
) -> dict:
    """Breadcrumb of where the van has been (GPS fixes only), oldest
    first — the data behind the Trips view. Sync `def` so the SQLite read
    runs in the threadpool, not on the event loop."""
    points = location_service.history(since_timestamp=since, max_points=max_points)
    return {"points": points, "count": len(points)}


@router.delete("/history")
def delete_location_history(
    after: float | None = Query(default=None, description="Unix seconds - delete points at/after this time"),
    before: float | None = Query(default=None, description="Unix seconds - delete points at/before this time"),
) -> dict:
    """Purge a stretch of the breadcrumb trail — for cleaning out a
    known-bad run, e.g. erratic fixes in the first days after fitting a
    new GPS antenna. Requires at least one bound, so an empty call can't
    wipe the whole table by accident."""
    if after is None and before is None:
        raise HTTPException(status_code=400, detail="Provide 'after' and/or 'before' - refusing to delete everything")
    deleted = location_service.delete_history_range(after=after, before=before)
    return {"deleted": deleted}


@router.get("/trip-stats")
def get_trip_stats(
    since: float | None = Query(default=None, description="Unix seconds - measure from here instead of the trip marker"),
    all_time: bool = Query(default=False, description="Ignore the trip marker and measure the whole trail"),
) -> dict:
    """Distance travelled, computed from the FULL trail on the backend.

    Deliberately not computed on the phone: /history strides its points
    down to max_points, and the distance filters reason about gaps
    between consecutive points, so a decimated trail rejects real
    driving as drift and the total drifts as the table grows. See
    location_service.trip_stats().
    """
    marker = None if all_time else _trip_started_at()
    start = since if since is not None else (marker or 0.0)
    stats = location_service.trip_stats(since_timestamp=start)
    stats["trip_started_at"] = marker
    stats["measured_from"] = start or None
    return stats


class TripStart(BaseModel):
    started_at: float | None = None


def _trip_started_at() -> float | None:
    raw = (configuration_service.get("general", {}) or {}).get("trip_started_at")
    try:
        return float(raw) if raw else None
    except (TypeError, ValueError):
        return None


@router.put("/trip-start")
def set_trip_start(body: TripStart) -> dict:
    """Mark where 'this trip' begins.

    A MARKER, deliberately, not a delete. The ask was "I want to know
    how far I travel on this trip", and the obvious implementation is
    to purge everything older - but that is irreversible, throws away
    the travel history the Trips screen exists to accumulate, and has
    to be done BEFORE the trip to be any use. A marker can be set
    afterwards and moved freely: the data is already recorded, this
    only chooses where to measure from. Send null to clear it and go
    back to all-time.
    """
    general = dict(configuration_service.get("general", {}) or {})
    if body.started_at is None:
        general.pop("trip_started_at", None)
    else:
        general["trip_started_at"] = float(body.started_at)
    configuration_service.set("general", general)
    return {"trip_started_at": _trip_started_at()}


@router.get("/satellites")
def get_satellites() -> dict:
    """Real, current per-satellite elevation/azimuth/signal-strength -
    the data behind the sky-plot and satellite list in Settings. Only
    meaningful with the gps_serial plugin actually running (a browser's
    Geolocation API or the IP fallback have no equivalent data at all -
    this is specifically what a real GPS receiver's NMEA stream carries
    that nothing else can)."""
    if _manager is None:
        raise HTTPException(status_code=503, detail="Plugin manager not ready yet")
    plugin = _manager.get("gps_serial")
    if plugin is None:
        raise HTTPException(status_code=404, detail="GPS plugin not available")
    satellites = plugin.get_satellites() if hasattr(plugin, "get_satellites") else []

    from app.plugins.gps_serial.plugin import snr_quality

    # Computed here, once, from the plugin's own SNR thresholds - never
    # reimplemented in the frontend, so there's only one definition of
    # what "strong/good/fair/poor" means.
    for sat in satellites:
        sat["quality"] = snr_quality(sat["snr"])
    return {"satellites": satellites, "count": len(satellites)}
