from __future__ import annotations

import time

from fastapi import APIRouter

from app.core.config import settings
from app.plugins.base import registry

router = APIRouter()

_startup_time = time.time()


@router.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "app_name": settings.app_name,
        "environment": settings.environment,
        "simulation_mode": settings.simulation_mode,
        "uptime_seconds": round(time.time() - _startup_time, 1),
        "plugins": registry.health(),
    }
