"""
WiFi API — powers Settings → Network.
"""

from __future__ import annotations

import ipaddress
import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.services.configuration_service import configuration_service
from app.services.wifi_service import WifiUnavailableError, wifi_service

logger = logging.getLogger("vanos.api.wifi")

router = APIRouter(prefix="/api/wifi", tags=["wifi"])


class ConnectRequest(BaseModel):
    ssid: str
    password: str | None = None


def _client_is_local(request: Request) -> bool:
    """True when the request came from a private/loopback address.

    Requests arriving through a Cloudflare Tunnel are forwarded by
    cloudflared, so the immediate peer is loopback — X-Forwarded-For
    carries the real client. Treat the request as remote if that header
    is present at all, since nothing on the LAN sets it.
    """
    if request.headers.get("x-forwarded-for") or request.headers.get("cf-connecting-ip"):
        return False

    host = request.client.host if request.client else None
    if not host:
        return False
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    return address.is_private or address.is_loopback


def _enforce_access(request: Request) -> None:
    lan_only = configuration_service.get("general", {}).get("wifi_control_lan_only", False)
    if lan_only and not _client_is_local(request):
        raise HTTPException(
            status_code=403,
            detail="WiFi control is restricted to the local network (wifi_control_lan_only is enabled)",
        )


@router.get("/status")
async def wifi_status(request: Request) -> dict:
    _enforce_access(request)
    try:
        status = await wifi_service.status()
        status["known_networks"] = await wifi_service.known_networks()
        return status
    except WifiUnavailableError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/scan")
async def wifi_scan(request: Request) -> dict:
    _enforce_access(request)
    try:
        # Wrapped in an object (not a bare list) because the frontend
        # reads `scan.data.networks` - see api.wifiScan / Settings.tsx.
        return {"networks": await wifi_service.scan()}
    except WifiUnavailableError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/connect")
async def wifi_connect(request: Request, body: ConnectRequest) -> dict:
    _enforce_access(request)
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
