"""
The single WebSocket stream the frontend connects to.

On connect, we immediately send the latest known snapshot for every
domain (so the UI isn't blank for a full tick), then stream every new
TelemetryMessage as it's published to the bus — regardless of which
plugin produced it.
"""

from __future__ import annotations

import asyncio
import logging
from urllib.parse import urlsplit

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.auth_service import auth_service
from app.telemetry.bus import bus

logger = logging.getLogger("vanos.websocket")

router = APIRouter()


@router.websocket("/ws/telemetry")
async def telemetry_stream(websocket: WebSocket) -> None:
    # Origin check: a browser always sends Origin on a WS handshake, and
    # WS is NOT subject to CORS — so without this, any web page could open
    # this socket and read the live telemetry stream. Reject when the
    # Origin's host doesn't match the host we're being reached on.
    origin = websocket.headers.get("origin")
    host = (websocket.headers.get("host") or "").split(":")[0]
    if origin and host and urlsplit(origin).hostname != host:
        await websocket.close(code=4403)
        return

    # Auth: same gate as the REST routes. Browsers can't set headers on a
    # WS, so the token comes via a query param. Fails closed in production
    # without a password, exactly like require_app_token.
    if not auth_service.verify_token(websocket.query_params.get("token")):
        await websocket.close(code=4401)
        return

    await websocket.accept()
    queue = bus.subscribe()

    try:
        # Send current snapshot immediately on connect
        snapshot = bus.latest_all()
        for message in snapshot.values():
            await websocket.send_text(message.model_dump_json())

        while True:
            message = await queue.get()
            await websocket.send_text(message.model_dump_json())

    except WebSocketDisconnect:
        logger.info("Client disconnected from telemetry stream")
    except asyncio.CancelledError:
        raise
    finally:
        bus.unsubscribe(queue)
