"""
Diesel heater control.

Auth-gated, like relays and roof: this drives a combustion device and
the app is reachable from outside the van over the tunnel.

The ignition/cooldown guards live in the plugin rather than here, so
they hold however the heater is commanded - a future voice command or
automation gets the same protection as a button press. This layer only
translates the plugin's refusals into HTTP: 409 for "not now", 503 for
"no connection", 400 for a bad value.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.routes.auth import require_app_token
from app.api.routes.plugins import get_manager
from app.plugins.hcalory_heater.plugin import HeaterBusy, HeaterUnavailable

router = APIRouter(prefix="/api/heater", tags=["heater"], dependencies=[Depends(require_app_token)])


class PowerRequest(BaseModel):
    on: bool


class TemperatureRequest(BaseModel):
    celsius: int


class LevelRequest(BaseModel):
    level: int


class ModeRequest(BaseModel):
    mode: str


def _plugin():
    plugin = get_manager().get("hcalory_heater")

    if plugin is None:
        # Not configured is a different answer from not connected, and
        # the UI should be able to say which.
        raise HTTPException(status_code=404, detail="The heater plugin is not enabled.")

    return plugin


async def _run(coro):
    try:
        return await coro
    except HeaterBusy as e:
        raise HTTPException(status_code=409, detail=str(e))
    except HeaterUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("")
async def get_heater() -> dict:
    plugin = _plugin()
    return {
        "available": plugin.connected,
        "status": plugin.status.value,
        "error": plugin.last_error,
        "state": plugin.latest,
    }


@router.post("/power")
async def set_power(body: PowerRequest) -> dict:
    return await _run(_plugin().set_power(body.on))


@router.post("/temperature")
async def set_temperature(body: TemperatureRequest) -> dict:
    return await _run(_plugin().set_target_temperature(body.celsius))


@router.post("/level")
async def set_level(body: LevelRequest) -> dict:
    return await _run(_plugin().set_level(body.level))


@router.post("/mode")
async def set_mode(body: ModeRequest) -> dict:
    return await _run(_plugin().set_mode(body.mode))


@router.post("/auto-start-stop")
async def toggle_auto(body: dict | None = None) -> dict:
    return await _run(_plugin().toggle_auto_start_stop())
