"""
Camera API — live view for the USB webcam. See camera_service.py for
why this bypasses go2rtc entirely for this use case, and why /snapshot
(auto-refreshing single images) is used over /stream (continuous
multipart) despite /stream working fine on desktop - consistency and
guaranteed-everywhere reliability over a smoother but platform-
dependent experience.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import StreamingResponse

from app.services.camera_service import CameraUnavailableError, camera_service

router = APIRouter(prefix="/api/camera", tags=["camera"])


@router.get("/snapshot")
async def camera_snapshot() -> Response:
    try:
        jpeg_bytes = await camera_service.capture_snapshot()
    except CameraUnavailableError as e:
        raise HTTPException(status_code=503, detail=str(e))
    # No Cache-Control override here deliberately: the frontend already
    # guarantees freshness via a unique timestamp query param on every
    # request, and it also preloads each new image before swapping the
    # visible one to it (see Camera.tsx) - that technique specifically
    # needs the browser willing to reuse an already-fetched image
    # rather than being told never to cache anything at all.
    return Response(content=jpeg_bytes, media_type="image/jpeg")


@router.get("/stream")
async def camera_stream() -> StreamingResponse:
    try:
        process = await camera_service.open()
    except CameraUnavailableError as e:
        raise HTTPException(status_code=503, detail=str(e))
    return StreamingResponse(camera_service.mjpeg_frames(process), media_type="multipart/x-mixed-replace; boundary=frame")
