"""
Intelligence API — the Mission Brief (Green/Amber/Red status,
recommendations, predictions).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.api.routes.auth import require_app_token
from app.intelligence.engine import IntelligenceEngine, MissionBrief
from app.services.arrival_notification_service import arrival_notification_service

# Gated: the mission brief includes real battery/solar readings and
# derived predictions - not as sensitive as location or the camera, but
# still genuine telemetry about the van's state, and this router had no
# auth at all (an oversight caught in an unrelated audit, not a
# reported symptom) - every other telemetry-adjacent router in this
# app is gated, this one just got missed.
router = APIRouter(prefix="/api/intelligence", tags=["intelligence"], dependencies=[Depends(require_app_token)])

_engine: IntelligenceEngine | None = None


def set_engine(engine: IntelligenceEngine) -> None:
    global _engine
    _engine = engine


def get_engine() -> IntelligenceEngine | None:
    """Public accessor so other backend services (ai_chat_service.py's
    Ron grounding, for one) can read the same shared engine instance
    without importing main.py directly - avoids the circular-import
    risk of a service reaching into the module that constructs it, same
    reasoning set_engine() already exists for."""
    return _engine


@router.get("/mission-brief")
async def get_mission_brief() -> MissionBrief:
    if _engine is None:
        raise HTTPException(status_code=503, detail="Intelligence engine not started yet")
    brief = _engine.latest()
    if brief is None:
        raise HTTPException(status_code=503, detail="No mission brief computed yet")
    return brief


@router.post("/arrival-check")
async def trigger_arrival_check(bypass_renotify_check: bool = False) -> dict:
    """Manual test entrypoint for arrival_notification_service - runs
    the real announce pipeline (POI search, AI recommendation, real
    notification) immediately at the current location, bypassing the
    normal 20-minute stay-duration wait. Same "let the real pipeline
    be tested without waiting for the real trigger" reasoning as voice
    control's own trigger_test().

    bypass_renotify_check=true skips the cost-safety check that
    normally stops a repeat announcement near somewhere already
    covered - useful for testing the SAME spot twice in a row, but
    means a real API call each time, so it's off by default.
    """
    return await arrival_notification_service.trigger_check_now(bypass_renotify_check=bypass_renotify_check)
