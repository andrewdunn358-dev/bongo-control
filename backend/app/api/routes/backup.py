"""
Backup/restore API — download or replace data/config.json and
data/vanos.db as a single zip.

Gated the same as /api/config: a backup contains everything in
config.json (including plugin secrets and WiFi credentials) plus the
whole telemetry/location/places database, and restore is a destructive,
whole-file replace. Treated with at least as much care as any other
irreversible action in this app.
"""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response

from app.api.routes.auth import require_app_token
from app.services.backup_service import BackupError, backup_service

router = APIRouter(prefix="/api/backup", tags=["backup"], dependencies=[Depends(require_app_token)])


@router.get("")
def download_backup() -> Response:
    try:
        data = backup_service.build_zip()
    except BackupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    filename = f"vanos-backup-{time.strftime('%Y-%m-%d')}.zip"
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/restore")
async def restore_backup(file: UploadFile = File(...)) -> dict:
    data = await file.read()
    try:
        backup_service.restore_zip(data)
    except BackupError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "message": "Restored. The app is restarting - reload in a few seconds."}
