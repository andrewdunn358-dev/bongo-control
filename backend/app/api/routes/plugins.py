"""
Plugin Manager API — powers the Plugin Status page.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.plugins.manager import PluginManager

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
