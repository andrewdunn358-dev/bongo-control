"""
System API — operational actions on the backend process itself, not
any van hardware. Currently just a restart trigger.
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal

from fastapi import APIRouter, Depends

from app.api.routes.auth import require_app_token

logger = logging.getLogger("vanos.system")

# Gated the same as every other sensitive route in this app - a
# restart is genuinely disruptive (relays, voice control, telemetry
# all drop for the few seconds it takes to come back up), and the app
# is reachable from the whole internet once someone finds the
# Cloudflare hostname.
router = APIRouter(prefix="/api/system", tags=["system"], dependencies=[Depends(require_app_token)])


async def _delayed_shutdown() -> None:
    """A brief delay so the HTTP response actually reaches the client
    before the process starts shutting down.

    Reported live: a relay that had genuinely been turned off came
    back ON after using this button - confirmed root cause: this
    originally called os._exit(0), a hard, immediate kill that skips
    Python entirely, including uvicorn's own signal handling and this
    app's own lifespan shutdown code. relay_service.stop() (which
    saves each relay's ACTUAL CURRENT commanded state as a "clean
    shutdown" record for the next startup to restore - see its own
    docstring) lives in that shutdown code, right after the lifespan's
    `yield`. Skipping it meant the next startup restored whatever
    STALE state was left over from the last genuinely clean shutdown
    (a real docker compose deploy, which always goes through this
    properly) - not what the relay actually was at the moment this
    button was pressed.

    Fixed by sending this process a real SIGTERM instead of killing it
    directly - the same signal Docker itself sends for an ordinary
    `docker compose down`/redeploy, which uvicorn is already built to
    catch and forward into a graceful shutdown, correctly running
    relay_service.stop() (and everything else after the lifespan's
    `yield`) before the process actually exits. Docker's own
    restart: unless-stopped policy on the backend service (confirmed
    in docker-compose.yml) still brings the container straight back up
    once uvicorn finishes exiting - nothing about that part changes.
    """
    await asyncio.sleep(0.5)
    logger.info(
        "System: restart requested via API - sending SIGTERM for a graceful shutdown "
        "(so relay_service.stop() and the rest of the normal shutdown sequence run correctly), "
        "then docker-compose's restart:unless-stopped policy brings the container back up"
    )
    os.kill(os.getpid(), signal.SIGTERM)


@router.post("/restart-backend")
async def restart_backend() -> dict:
    """Triggers a graceful shutdown of this process (see
    _delayed_shutdown()'s own docstring for why it must be graceful,
    not a hard kill). docker-compose.yml's backend service has
    restart: unless-stopped (confirmed by reading it directly) -
    Docker brings the container straight back up once this process
    exits, no separate action needed.

    This is a PROCESS restart only - it does NOT git pull, rebuild, or
    pick up new code. What it DOES pick up: config changes that need a
    fresh start to take effect (a new mic/speaker device, wake word,
    TTS provider, etc. - the always-on wake-word listener specifically
    only re-reads these at startup, not live). For deploying actual
    code changes, the real docker compose up -d --build command on the
    Pi is still what's needed - this button is for "I changed a
    setting and need the backend to notice", not "I pushed new code".
    """
    asyncio.create_task(_delayed_shutdown())
    return {"restarting": True}
