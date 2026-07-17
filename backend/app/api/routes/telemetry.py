"""
REST snapshot endpoints — one per telemetry domain.

These are intentionally thin: they just ask the TelemetryBus for its
current cached value for that domain. They exist for:
  - initial page load / non-JS fallback
  - debugging (`curl` a single domain without opening a websocket)
  - future consumers that don't want a persistent connection

The WebSocket stream (/ws/telemetry) remains the primary path for live
updates in the frontend.
"""

from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException

from app.services import history_service
from app.services.history_service import PERSISTED_DOMAINS
from app.telemetry.bus import bus
from app.telemetry.models import TelemetryDomain

router = APIRouter(prefix="/api", tags=["telemetry"])


def _snapshot_or_404(domain: TelemetryDomain) -> dict:
    message = bus.latest(domain)
    if message is None:
        raise HTTPException(status_code=503, detail=f"No {domain.value} data yet — is a plugin running?")
    return message.model_dump()


@router.get("/energy")
async def get_energy() -> dict:
    return _snapshot_or_404(TelemetryDomain.ENERGY)


@router.get("/battery")
async def get_battery() -> dict:
    return _snapshot_or_404(TelemetryDomain.BATTERY)


@router.get("/solar")
async def get_solar() -> dict:
    return _snapshot_or_404(TelemetryDomain.SOLAR)


@router.get("/environment")
async def get_environment() -> dict:
    return _snapshot_or_404(TelemetryDomain.ENVIRONMENT)


@router.get("/connectivity")
async def get_connectivity() -> dict:
    return _snapshot_or_404(TelemetryDomain.CONNECTIVITY)


@router.get("/system")
async def get_system() -> dict:
    """Includes the Power Budget payload."""
    return _snapshot_or_404(TelemetryDomain.SYSTEM)


@router.get("/history/{domain}")
async def get_history(domain: TelemetryDomain, hours: float = 24.0) -> list[dict]:
    """Real, persisted history (Milestone 5) for domains worth graphing
    over time (battery, solar, energy, environment, connectivity) -
    backed by SQLite, sampled at a bounded interval rather than every
    tick (see HistoryService for why). Falls back to the bus's small
    in-memory ring buffer for domains that aren't persisted (currently
    just notification, which is event-shaped rather than a time series).
    """
    if domain.value in PERSISTED_DOMAINS:
        since = time.time() - (hours * 3600)
        return history_service.query(domain.value, since)
    return [m.model_dump() for m in bus.history(domain)]
