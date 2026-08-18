"""
Camera API — live view for the USB webcam. See camera_service.py for
why this bypasses go2rtc entirely for this use case, and why /snapshot
(auto-refreshing single images) is used over /stream (continuous
multipart) despite /stream working fine on desktop - consistency and
guaranteed-everywhere reliability over a smoother but platform-
dependent experience.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import StreamingResponse

from app.api.routes.auth import require_app_token
from app.services.camera_service import CameraUnavailableError, camera_service, live_producer
from app.services.snapshot_store import SnapshotError, snapshot_store

logger = logging.getLogger("vanos.camera")

router = APIRouter(prefix="/api/camera", tags=["camera"], dependencies=[Depends(require_app_token)])


@router.get("/snapshot")
async def camera_snapshot() -> Response:
    # While a Live stream is running, the producer owns /dev/video0 and
    # this must NOT open the device itself - that contention is the whole
    # bug this design fixes. Serve the producer's latest frame instead.
    #
    # latest_frame() returns None for a frame older than the freshness
    # threshold, and that deliberately becomes an error rather than a
    # fallback capture: attempting a capture here would open the device
    # the producer still holds, which is exactly what we are preventing.
    # An honest 503 beats either a stale frame labelled live or a
    # collision.
    if live_producer.active:
        frame = live_producer.latest_frame()
        if frame is None:
            raise HTTPException(
                status_code=503,
                detail="Live stream is running but has no current frame - camera may be stalled",
            )
        return Response(content=frame[0], media_type="image/jpeg")

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
    # Goes through the shared producer rather than spawning its own
    # ffmpeg. subscribe() starts the producer if needed, converges
    # concurrent requests on ONE process, and waits for a real first
    # frame - so a failure surfaces as an HTTP error here rather than as
    # a stream that opens and contains nothing.
    try:
        sub_id = await live_producer.subscribe()
    except CameraUnavailableError as e:
        # Logged, not just returned. An <img> reports only "failed to
        # load" with no status or body, so without this line a 503 here
        # is completely silent server-side - which is exactly what
        # happened on the first real deployment of this.
        logger.warning("Camera stream refused: %s", e)
        raise HTTPException(status_code=503, detail=str(e))
    return StreamingResponse(
        live_producer.frames(sub_id), media_type="multipart/x-mixed-replace; boundary=frame"
    )


# ---- Saved snapshots (persisted on the Pi's data volume) ----
#
# The "Snapshot" button captures a fresh frame and stores it as a file
# on the Pi rather than only in browser memory, so snapshots survive a
# reload and can be reviewed or deleted later from the dashboard.


@router.post("/snapshots", status_code=201)
async def save_snapshot() -> dict:
    # Same producer rule as GET /snapshot. Easy to miss, and it matters:
    # this is the "Snapshot" button, and pressing it while watching the
    # Live stream is an entirely normal thing to do - which is precisely
    # when the device is held by the producer.
    if live_producer.active:
        frame = live_producer.latest_frame()
        if frame is None:
            raise HTTPException(
                status_code=503,
                detail="Live stream is running but has no current frame - camera may be stalled",
            )
        jpeg_bytes = frame[0]
    else:
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
