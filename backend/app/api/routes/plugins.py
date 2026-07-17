"""
Plugin management API — powers the Plugin Status page.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.plugins.manager import PluginManager
from app.services.configuration_service import configuration_service

router = APIRouter(prefix="/api/plugins", tags=["plugins"])

# Set by main.py at startup (avoids a circular import with the manager
# needing the bus/services, which main.py wires together).
_manager: PluginManager | None = None


def set_manager(manager: PluginManager) -> None:
    global _manager
    _manager = manager


def get_manager() -> PluginManager:
    """Public accessor for other route modules (health, settings) that
    also need to report plugin status without duplicating startup wiring.
    """
    return _get_manager()


def _get_manager() -> PluginManager:
    if _manager is None:
        raise HTTPException(status_code=503, detail="Plugin manager not initialized")
    return _manager


def get_active_mode() -> str:
    """Derived from actual plugin state, not a static config flag - this
    is what was wrong before: a fixed 'simulation_mode' setting kept
    saying 'Simulation' even after switching to real hardware, since it
    never actually reflected which plugin was running.
    """
    plugins = _get_manager().health()
    if any(p["status"] == "running" and p["name"] != "simulation" for p in plugins):
        return "live_hardware"
    if any(p["status"] == "running" and p["name"] == "simulation" for p in plugins):
        return "simulation"
    return "none"


class PluginConfigUpdate(BaseModel):
    config: dict[str, Any]


@router.get("")
async def list_plugins() -> list[dict]:
    return _get_manager().health()


@router.post("/{name}/enable")
async def enable_plugin(name: str) -> dict:
    ok = await _get_manager().enable(name)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Unknown plugin '{name}'")
    return {"name": name, "enabled": True}


@router.post("/{name}/disable")
async def disable_plugin(name: str) -> dict:
    ok = await _get_manager().disable(name)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Unknown plugin '{name}'")
    return {"name": name, "enabled": False}


@router.get("/{name}/config")
async def get_plugin_config(name: str) -> dict:
    if _get_manager().get(name) is None:
        raise HTTPException(status_code=404, detail=f"Unknown plugin '{name}'")
    return configuration_service.get_plugin_config(name)


@router.put("/{name}/config")
async def update_plugin_config(name: str, body: PluginConfigUpdate) -> dict:
    """Merges into the plugin's config (e.g. mac_address, encryption_key
    for victron_mppt) without wiping the enabled flag or other fields.
    Does not itself start/stop the plugin — call enable/disable after
    updating config for it to take effect.
    """
    if _get_manager().get(name) is None:
        raise HTTPException(status_code=404, detail=f"Unknown plugin '{name}'")
    return configuration_service.update_plugin_config(name, body.config)


@router.post("/{name}/scan")
async def scan_plugin(name: str, duration: float = 10.0) -> list[dict]:
    """Triggers a one-shot device-discovery scan for plugins that
    support it (currently just victron_mppt). Independent of the
    plugin's enabled/running state — useful specifically for confirming
    hardware is visible over Bluetooth at all before fully configuring
    or enabling anything.
    """
    plugin = _get_manager().get(name)
    if plugin is None:
        raise HTTPException(status_code=404, detail=f"Unknown plugin '{name}'")
    try:
        return await plugin.scan(duration_seconds=duration)
    except NotImplementedError as e:
        raise HTTPException(status_code=501, detail=str(e))
