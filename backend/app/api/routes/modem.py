"""
Modem diagnostics — raw HiLink signal reading from the van's Huawei
B525, over the LAN link the Pi already has to it.

Diagnostic-only route. The plan is to log this against the GPS
breadcrumb and render a measured-signal heatmap on the map (see
trip-log-milestone.md / offline-maps-m10.md's coverage notes) — that
comes after confirming these numbers look right against the real
router, hence a route that just echoes the reading back rather than
storing or acting on it yet.

Gated the same way as everything else that reaches out to real
hardware or a real network — no reason for this one to be the exception.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from app.api.routes.auth import require_app_token
from app.services.modem_service import ModemError, modem_service

logger = logging.getLogger("vanos.modem_route")

router = APIRouter(prefix="/api/modem", tags=["modem"], dependencies=[Depends(require_app_token)])


@router.get("/signal")
async def signal() -> dict:
    """Raw reading from GET device/signal on the router — whatever
    fields it actually returns (rsrp, rsrq, sinr, band, cell_id, mode,
    etc, per the HiLink API), unmodified. The point of this endpoint is
    to see the real shape before anything downstream assumes field
    names that turn out to be wrong for this firmware."""
    logger.info("GET /api/modem/signal received")
    try:
        host, data = await modem_service.signal()
        logger.info("GET /api/modem/signal: success (host=%s)", host)
        return {"reachable": True, "host": host, "raw": data}
    except ModemError as e:
        logger.warning("GET /api/modem/signal: %s", e)
        raise HTTPException(status_code=502, detail=str(e)) from e
