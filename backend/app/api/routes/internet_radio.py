"""
Internet Radio API — play/pause/stop a streaming radio station through
the van's speaker.

Auth-gated in full, same reasoning as relays.py: this drives real
hardware (the amp/speaker) and is reachable over the public internet
via the Cloudflare Tunnel, even though the worst case here is "annoying
noise" rather than a physical safety concern.

Every call into internet_radio_service goes through asyncio.to_thread.
Those methods do raw blocking socket I/O against mpv's IPC socket
(sock.recv(), up to IPC_TIMEOUT_SECONDS per read, and the event-line
skip loop can retry several times) - calling them directly from an
async def handler would block this whole server's single event loop
for the duration, not just this one request. That's exactly what
happened before this fix: the status poll (every 5s while the Radio
page is open) periodically stalled the entire backend, taking the
telemetry WebSocket and every other route down with it (seen as 502s
and dropped WebSocket connections) even though the backend process
itself never crashed. Same category of bug as "H1" in this project's
own code review (synchronous DB queries on the async event loop) -
just a new instance of it, in new code.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.routes.auth import require_app_token
from app.services.internet_radio_service import InternetRadioUnavailableError, internet_radio_service

router = APIRouter(prefix="/api/internet-radio", tags=["internet-radio"], dependencies=[Depends(require_app_token)])


class PlayRequest(BaseModel):
    url: str | None = None  # omit to play the configured default station


class VolumeRequest(BaseModel):
    level: int  # 0-100, clamped again service-side regardless of what's sent


@router.get("/status")
async def get_status() -> dict:
    return await asyncio.to_thread(internet_radio_service.status)


@router.post("/volume")
async def set_volume(body: VolumeRequest) -> dict:
    try:
        return await asyncio.to_thread(internet_radio_service.set_volume, body.level)
    except InternetRadioUnavailableError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/play")
async def play(body: PlayRequest = PlayRequest()) -> dict:
    try:
        return await asyncio.to_thread(internet_radio_service.play, body.url)
    except InternetRadioUnavailableError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/pause")
async def pause() -> dict:
    try:
        return await asyncio.to_thread(internet_radio_service.pause)
    except InternetRadioUnavailableError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/resume")
async def resume() -> dict:
    try:
        return await asyncio.to_thread(internet_radio_service.resume)
    except InternetRadioUnavailableError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/stop")
async def stop() -> dict:
    return await asyncio.to_thread(internet_radio_service.stop)
