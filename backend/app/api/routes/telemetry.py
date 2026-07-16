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

from fastapi import APIRouter, HTTPException

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
async def get_history(domain: TelemetryDomain) -> list[dict]:
    """Placeholder for Milestone 5 (history graphs). Currently returns
    whatever's in the bus's in-memory ring buffer; will be backed by
    SQLite once persistent logging is implemented.
    """
    return [m.model_dump() for m in bus.history(domain)]
