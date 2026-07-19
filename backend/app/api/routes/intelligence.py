"""
Intelligence API — the Mission Brief (Green/Amber/Red status,
recommendations, predictions).
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.intelligence.engine import IntelligenceEngine, MissionBrief

router = APIRouter(prefix="/api/intelligence", tags=["intelligence"])

_engine: IntelligenceEngine | None = None


def set_engine(engine: IntelligenceEngine) -> None:
    global _engine
    _engine = engine


@router.get("/mission-brief")
async def get_mission_brief() -> MissionBrief:
    if _engine is None:
        raise HTTPException(status_code=503, detail="Intelligence engine not started yet")
    brief = _engine.latest()
    if brief is None:
        raise HTTPException(status_code=503, detail="No mission brief computed yet")
    return brief
