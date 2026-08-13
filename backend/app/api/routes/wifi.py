"""
WiFi API — powers Settings → Network.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.wifi_service import WifiUnavailableError, wifi_service

# No auth gate here by design - personal project, kept deliberately simple.
# If that's ever wrong for your setup, the fix is to re-add
# `dependencies=[Depends(require_app_token)]` (the same gate every other
# router uses), not to add a new bespoke restriction.
router = APIRouter(prefix="/api/wifi", tags=["wifi"])


class ConnectRequest(BaseModel):
    ssid: str
    password: str | None = None


@router.get("/status")
async def wifi_status() -> dict:
    try:
        status = await wifi_service.status()
        status["known_networks"] = await wifi_service.known_networks()
        return status
    except WifiUnavailableError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/scan")
async def wifi_scan() -> dict:
    try:
        # Wrapped in an object (not a bare list) because the frontend
        # reads `scan.data.networks` - see api.wifiScan / Settings.tsx.
        return {"networks": await wifi_service.scan()}
    except WifiUnavailableError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/connect")
async def wifi_connect(body: ConnectRequest) -> dict:
    try:
        status = await wifi_service.connect(body.ssid, body.password)
        # Shape matches api.wifiConnect's expected {ok, connected_to, ip}.
        return {
            "ok": bool(status.get("connected")),
            "connected_to": status.get("ssid") or body.ssid,
            "ip": status.get("ip"),
        }
    except WifiUnavailableError as e:
        # Wrong password, out of range, etc. all surface here — nmcli's
        # own message is the most useful thing to show the user.
        raise HTTPException(status_code=400, detail=str(e))
