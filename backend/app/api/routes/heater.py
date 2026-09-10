"""
Diesel heater control.

Auth-gated like relays and roof: this drives a combustion device and the
app is reachable from outside the van over the tunnel.

Commands are PROXIED to the host-side agent (tools/heater_agent.py),
which owns the Bluetooth link. The container has no BLE path to the
heater at all - see the plugin docstring for why.

The ignition and cooldown guards live in the agent, not here, because
the agent is the only process that can actually reach the heater and
knows its live state. This layer just carries its answers through:
409 for "not now", 503 for "no connection", 400 for a bad value. Those
statuses are deliberately preserved rather than flattened into 500 -
"the heater is igniting, wait" is guidance, not a failure.
"""

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.routes.auth import require_app_token
from app.api.routes.plugins import get_manager

router = APIRouter(prefix="/api/heater", tags=["heater"], dependencies=[Depends(require_app_token)])

# Generous: a command waits for the heater to act before reading back,
# and the agent deliberately pauses to avoid returning a stale state.
COMMAND_TIMEOUT = 45.0

AGENT_UNREACHABLE = (
    "Can't reach the heater agent. It runs on the Pi host, not in Docker - "
    "check `sudo systemctl status vanos-heater-agent`."
)


def _plugin():
    plugin = get_manager().get("hcalory_heater")

    if plugin is None:
        # Not enabled is a different answer from not connected, and the
        # UI should be able to say which.
        raise HTTPException(status_code=404, detail="The heater plugin is not enabled.")

    return plugin


async def _post(path: str, body: dict) -> dict:
    agent = _plugin().agent_url

    try:
        async with httpx.AsyncClient(timeout=COMMAND_TIMEOUT) as client:
            response = await client.post(f"{agent}{path}", json=body)
    except httpx.HTTPError:
        raise HTTPException(status_code=503, detail=AGENT_UNREACHABLE)

    if response.status_code >= 400:
        detail = "Heater command failed."
        try:
            detail = response.json().get("detail", detail)
        except ValueError:
            pass
        # Carried through as-is: the agent's 409 means "not now", and
        # turning that into a 500 here would lose the distinction.
        raise HTTPException(status_code=response.status_code, detail=detail)

    return response.json()


class PowerRequest(BaseModel):
    on: bool


class TemperatureRequest(BaseModel):
    celsius: int


class LevelRequest(BaseModel):
    level: int


class ModeRequest(BaseModel):
    mode: str


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
    return await _post("/power", {"on": body.on})


@router.post("/temperature")
async def set_temperature(body: TemperatureRequest) -> dict:
    return await _post("/temperature", {"celsius": body.celsius})


@router.post("/level")
async def set_level(body: LevelRequest) -> dict:
    return await _post("/level", {"level": body.level})


@router.post("/mode")
async def set_mode(body: ModeRequest) -> dict:
    return await _post("/mode", {"mode": body.mode})


@router.post("/auto-start-stop")
async def toggle_auto() -> dict:
    return await _post("/auto-start-stop", {})


@router.post("/ventilate")
async def ventilate() -> dict:
    """Fan only, no burn. Refused by the agent unless the heater is in
    standby - see the note there."""
    return await _post("/ventilate", {})
