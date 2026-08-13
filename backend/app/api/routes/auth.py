"""
Auth API — powers the app-wide unlock screen, and gates sensitive
routes (camera, relays, roof, location, config, plugins, wifi).
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
    """Lets the frontend decide what to show before rendering the app:
    - required: a password gate applies (unlock screen).
    - insecure_blocked: production has NO password and no insecure opt-in,
      so gated routes fail closed and the operator must set
      APP_ACCESS_PASSWORD (the UI shows an actionable message — there's
      nothing to type, so it's not an unlock screen).
    """
    blocked = auth_service.gate_blocks_unconfigured()
    return {
        "required": auth_service.is_configured() or blocked,
        "configured": auth_service.is_configured(),
        "insecure_blocked": blocked,
    }


@router.post("/unlock")
async def unlock(body: UnlockRequest) -> dict:
    # Rate-limit before touching the password, to blunt online brute force
    # of the single shared secret.
    if auth_service.unlock_throttled():
        raise HTTPException(
            status_code=429,
            detail="Too many attempts — wait a minute and try again.",
        )
    if not auth_service.check_password(body.password):
        auth_service.register_unlock_failure()
        raise HTTPException(status_code=401, detail="Incorrect password")
    auth_service.register_unlock_success()
    return {"token": auth_service.issue_token()}


async def require_app_token(x_app_token: str | None = Header(default=None), token: str | None = None) -> None:
    """FastAPI dependency — add `dependencies=[Depends(require_app_token)]`
    to any route that mutates hardware or exposes sensitive data.

    Accepts the token via the X-App-Token header OR a `token` query param
    (plain <img src> tags used for the camera snapshot can't set headers).

    Fails CLOSED with a clear operator message when production has no
    password configured, instead of the old silent fail-open.
    """
    if auth_service.gate_blocks_unconfigured():
        raise HTTPException(
            status_code=503,
            detail=(
                "This deployment has no APP_ACCESS_PASSWORD set. Set one on the Pi "
                "to enable protected features, or set VANOS_ALLOW_INSECURE=1 to run "
                "without a password on a trusted local network only."
            ),
        )
    provided = x_app_token or token
    if not auth_service.verify_token(provided):
        raise HTTPException(status_code=401, detail="App is locked - unlock with the password first")
