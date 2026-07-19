"""
Camera API — MJPEG live view for the USB webcam. See camera_service.py
for why this bypasses go2rtc entirely for this use case.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.services.camera_service import CameraUnavailableError, camera_service

router = APIRouter(prefix="/api/camera", tags=["camera"])


@router.get("/stream")
async def camera_stream() -> StreamingResponse:
    try:
        process = await camera_service.open()
    except CameraUnavailableError as e:
        raise HTTPException(status_code=503, detail=str(e))
    return StreamingResponse(camera_service.mjpeg_frames(process), media_type="multipart/x-mixed-replace; boundary=frame")
