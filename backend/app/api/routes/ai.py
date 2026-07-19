"""
AI Recommendations API — "what's genuinely cool nearby right now",
via Claude. See ai_recommendations_service.py for why this is one-shot
rather than a chat, and docs/ai_features.md for cost/privacy notes.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.api.routes.auth import require_app_token
from app.services import location_service, poi_service
from app.services.ai_recommendations_service import AiRecommendationsUnavailableError, ai_recommendations_service

# Gated by the same password auth as the camera - unlike viewing a
# camera feed, this incurs real API cost per genuinely-new location,
# and the app is reachable from the whole internet once someone finds
# the subdomain (Certificate Transparency logs make that discoverable
# regardless of how obscure the name is). The status check is left
# ungated - it reveals nothing sensitive, just whether the feature is
# configured at all.
router = APIRouter(prefix="/api/ai", tags=["ai"])


@router.get("/status")
async def ai_status() -> dict:
    return {"configured": ai_recommendations_service.is_configured()}


@router.get("/nearby-recommendations", dependencies=[Depends(require_app_token)])
async def nearby_recommendations() -> dict:
    location = location_service.get()
    if location is None:
        raise HTTPException(status_code=404, detail="No location set — configure one in Settings → General first")

    # Ground the model in real, already-known nearby places rather than
    # asking it to work from bare coordinates alone - reduces
    # hallucination risk and lets it reference genuinely local context.
    known_nearby: list[str] = []
    try:
        poi_result = await poi_service.search_nearby(location["latitude"], location["longitude"], radius_m=15000, categories=[])
        known_nearby = [p["name"] for p in poi_result["results"] if p.get("name")][:15]
    except Exception:
        pass  # POI lookup failing shouldn't block AI recommendations - just proceed with less grounding

    try:
        result = await ai_recommendations_service.get_recommendations(location["latitude"], location["longitude"], known_nearby)
    except AiRecommendationsUnavailableError as e:
        raise HTTPException(status_code=503, detail=str(e))

    return result
