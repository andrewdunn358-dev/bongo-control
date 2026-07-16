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

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.telemetry.bus import bus

logger = logging.getLogger("vanos.websocket")

router = APIRouter()


@router.websocket("/ws/telemetry")
async def telemetry_stream(websocket: WebSocket) -> None:
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
