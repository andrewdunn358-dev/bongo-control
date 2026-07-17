"""
Settings API — powers the Settings framework's "About" section (app
info) and re-exposes plugin health for backward compatibility with the
existing frontend Settings page shape. The Plugin Status page itself
now uses /api/plugins directly (richer data: version, heartbeat, error).
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.routes.plugins import get_active_mode, get_manager
from app.core.config import settings as app_settings

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("")
async def get_settings() -> dict:
    return {
        "app_name": app_settings.app_name,
        "environment": app_settings.environment,
        "mode": get_active_mode(),
        "plugins": get_manager().health(),
    }
