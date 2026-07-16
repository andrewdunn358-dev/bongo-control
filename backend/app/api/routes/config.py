"""
Configuration API — powers the Settings framework's sections (general/
appearance/hardware/notifications/developer). Sprint 4 scope is
framework + navigation only for these, so this is intentionally a thin
generic get/set over ConfigurationService rather than section-specific
validation — that can be added per-section as each one grows real
settings.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.configuration_service import configuration_service

router = APIRouter(prefix="/api/config", tags=["config"])

VALID_SECTIONS = {"general", "appearance", "hardware", "plugins", "notifications", "developer"}


class ConfigUpdate(BaseModel):
    value: dict[str, Any]


@router.get("/{section}")
async def get_config(section: str) -> dict:
    if section not in VALID_SECTIONS:
        raise HTTPException(status_code=404, detail=f"Unknown config section '{section}'")
    return configuration_service.get(section, {})


@router.put("/{section}")
async def set_config(section: str, body: ConfigUpdate) -> dict:
    if section not in VALID_SECTIONS:
        raise HTTPException(status_code=404, detail=f"Unknown config section '{section}'")
    configuration_service.set(section, body.value)
    return configuration_service.get(section, {})
