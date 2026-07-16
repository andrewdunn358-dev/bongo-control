"""
Settings API — powers the Settings page. Currently read-only and
returns app config + plugin status. Persisting user-editable settings
(units, thresholds, plugin enable/disable) is future work — the shape
here is deliberately simple so that can be added without breaking the
frontend contract.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.core.config import settings as app_settings
from app.plugins.base import registry

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("")
async def get_settings() -> dict:
    return {
        "app_name": app_settings.app_name,
        "environment": app_settings.environment,
        "simulation_mode": app_settings.simulation_mode,
        "plugins": registry.health(),
    }
