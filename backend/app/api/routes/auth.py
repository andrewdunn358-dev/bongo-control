"""
Auth API — powers the app-wide unlock screen, and gates sensitive
routes (camera now; relay control later, once that exists).
"""

from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from app.services.auth_service import auth_service

router = APIRouter(prefix="/api/auth", tags=["auth"])


class UnlockRequest(BaseModel):
    password: str


@router.get("/status")
async def auth_status() -> dict:
    """Lets the frontend know whether a gate even applies at all, before
    showing an unlock screen for a password that was never configured.
    """
    return {"required": auth_service.is_configured()}


@router.post("/unlock")
async def unlock(body: UnlockRequest) -> dict:
    if not auth_service.check_password(body.password):
        raise HTTPException(status_code=401, detail="Incorrect password")
    return {"token": auth_service.issue_token()}


async def require_app_token(x_app_token: str | None = Header(default=None), token: str | None = None) -> None:
    """FastAPI dependency - add `dependencies=[Depends(require_app_token)]`
    to any route that should be gated (camera now; future relay-control
    routes should get this too). A no-op if no password is configured
    at all, matching AuthService.is_configured()'s intent: don't lock
    anyone out of a gate nobody set up.

    Accepts the token via the X-App-Token header OR a `token` query
    param - not just the header. Plain <img src="..."> tags (used for
    the camera snapshot) cannot attach custom headers at all; a
    header-only check would silently never authenticate that route,
    the exact one this most needs to protect.
    """
    provided = x_app_token or token
    if not auth_service.verify_token(provided):
        raise HTTPException(status_code=401, detail="App is locked - unlock with the password first")
