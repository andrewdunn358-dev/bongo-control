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

VALID_SECTIONS = {"general", "appearance", "hardware", "plugins", "notifications", "developer", "location", "relays"}

# Secret keys are stored but NEVER returned in a GET (the app is reachable
# over the internet through the tunnel). Instead a "<key>_set" boolean is
# exposed so the UI can show "configured" without ever handling the value.
SECRET_KEYS = {"anthropic_api_key"}


def _redact(section_data: dict) -> dict:
    out = dict(section_data)
    for key in list(out.keys()):
        if key in SECRET_KEYS:
            out[f"{key}_set"] = bool(str(out.get(key) or "").strip())
            out[key] = ""  # never echo the secret back
    return out


class ConfigUpdate(BaseModel):
    value: dict[str, Any]


@router.get("/{section}")
async def get_config(section: str) -> dict:
    if section not in VALID_SECTIONS:
        raise HTTPException(status_code=404, detail=f"Unknown config section '{section}'")
    return _redact(configuration_service.get(section, {}))


@router.put("/{section}")
async def set_config(section: str, body: ConfigUpdate) -> dict:
    """Merges the supplied keys into the section rather than replacing
    it wholesale.

    This used to replace the entire section, which was a genuine
    footgun: PUTting a single plugin's config silently wiped every
    OTHER plugin's settings in that section - including their `enabled`
    flags, which meant a disabled plugin (the simulation) reverted to
    its default and started publishing again, overwriting real hardware
    telemetry with simulated data. Merging is what every caller
    actually wanted, and matches how update_plugin_config() on
    /api/plugins/{name}/config already behaves.

    Note this is a shallow merge - it replaces whole top-level keys
    within the section, not deeply. For plugin config specifically,
    prefer PUT /api/plugins/{name}/config, which scopes the update to
    one plugin and can't disturb its neighbours at all.
    """
    if section not in VALID_SECTIONS:
        raise HTTPException(status_code=404, detail=f"Unknown config section '{section}'")
    # For secret keys, an empty string means "leave unchanged" - so
    # saving the form without re-typing the API key keeps the stored one,
    # and the key is only ever written, never read back.
    incoming = {k: v for k, v in body.value.items() if not (k in SECRET_KEYS and not str(v or "").strip())}
    merged = {**configuration_service.get(section, {}), **incoming}
    configuration_service.set(section, merged)
    return _redact(configuration_service.get(section, {}))
