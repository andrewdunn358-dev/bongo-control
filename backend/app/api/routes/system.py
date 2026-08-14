"""
System API — operational actions on the backend process itself, not
any van hardware. Currently just a restart trigger.
"""

from __future__ import annotations

import asyncio
import logging
import os

from fastapi import APIRouter, Depends

from app.api.routes.auth import require_app_token

logger = logging.getLogger("vanos.system")

# Gated the same as every other sensitive route in this app - a
# restart is genuinely disruptive (relays, voice control, telemetry
# all drop for the few seconds it takes to come back up), and the app
# is reachable from the whole internet once someone finds the
# Cloudflare hostname.
router = APIRouter(prefix="/api/system", tags=["system"], dependencies=[Depends(require_app_token)])


async def _delayed_exit() -> None:
    """A brief delay so the HTTP response actually reaches the client
    before the process exits - calling os._exit() directly inside the
    request handler would very likely kill the process before uvicorn
    finishes writing the response, leaving the person with a dropped
    connection instead of the confirmation they asked for."""
    await asyncio.sleep(0.5)
    logger.info(
        "System: restart requested via API - exiting so docker-compose's "
        "restart:unless-stopped policy (confirmed in docker-compose.yml) brings the container back up"
    )
    os._exit(0)


@router.post("/restart-backend")
async def restart_backend() -> dict:
    """Deliberately exits this process. docker-compose.yml's backend
    service has restart: unless-stopped (confirmed by reading it
    directly) - Docker brings the container straight back up once this
    process ends, no separate action needed.

    This is a PROCESS restart only - it does NOT git pull, rebuild, or
    pick up new code. What it DOES pick up: config changes that need a
    fresh start to take effect (a new mic/speaker device, wake word,
    TTS provider, etc. - the always-on wake-word listener specifically
    only re-reads these at startup, not live). For deploying actual
    code changes, the real docker compose up -d --build command on the
    Pi is still what's needed - this button is for "I changed a
    setting and need the backend to notice", not "I pushed new code".
    """
    asyncio.create_task(_delayed_exit())
    return {"restarting": True}
