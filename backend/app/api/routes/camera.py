"""
Camera API — live view for the USB webcam. See camera_service.py for
why this bypasses go2rtc entirely for this use case, and why /snapshot
(auto-refreshing single images) is used over /stream (continuous
multipart) despite /stream working fine on desktop - consistency and
guaranteed-everywhere reliability over a smoother but platform-
dependent experience.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import StreamingResponse

from app.api.routes.auth import require_app_token
from app.services.camera_service import CameraUnavailableError, camera_service
from app.services.snapshot_store import SnapshotError, snapshot_store

router = APIRouter(prefix="/api/camera", tags=["camera"], dependencies=[Depends(require_app_token)])


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


# ---- Saved snapshots (persisted on the Pi's data volume) ----
#
# The "Snapshot" button captures a fresh frame and stores it as a file
# on the Pi rather than only in browser memory, so snapshots survive a
# reload and can be reviewed or deleted later from the dashboard.


@router.post("/snapshots", status_code=201)
async def save_snapshot() -> dict:
    try:
        jpeg_bytes = await camera_service.capture_snapshot()
    except CameraUnavailableError as e:
        raise HTTPException(status_code=503, detail=str(e))
    try:
        return snapshot_store.save(jpeg_bytes)
    except SnapshotError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/snapshots")
async def list_snapshots() -> dict:
    return {"snapshots": snapshot_store.list()}


@router.get("/snapshots/{snapshot_id}")
async def get_snapshot(snapshot_id: str) -> Response:
    try:
        jpeg_bytes = snapshot_store.read(snapshot_id)
    except SnapshotError as e:
        raise HTTPException(status_code=404, detail=str(e))
    # Saved snapshots never change once written, so let the browser
    # cache them hard - the id (capture timestamp) is unique per file.
    return Response(
        content=jpeg_bytes,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )


@router.delete("/snapshots/{snapshot_id}", status_code=204)
async def delete_snapshot(snapshot_id: str) -> Response:
    try:
        snapshot_store.delete(snapshot_id)
    except SnapshotError as e:
        # "not found" vs "invalid id" both map cleanly to 404 here.
        raise HTTPException(status_code=404, detail=str(e))
    return Response(status_code=204)
