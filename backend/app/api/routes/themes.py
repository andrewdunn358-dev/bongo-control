"""
Theme package API.

Installed themes live on the Pi so every device sees the same set - the
mounted tablet, a phone, a laptop - rather than each browser holding its
own copy. Which theme a device has SELECTED remains a local preference,
because the tablet may want a bright theme in daylight while a phone
stays dark at night.

Gated like the rest of the app. A theme package contains no secrets, but
installing one changes what every device in the van displays, so it is
not something an unauthenticated caller should be able to do.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response

from app.api.routes.auth import require_app_token
from app.services.theme_service import MAX_PACKAGE_BYTES, ThemeError, theme_service

router = APIRouter(prefix="/api/themes", tags=["themes"], dependencies=[Depends(require_app_token)])


@router.get("")
def list_themes() -> dict:
    return {"themes": theme_service.list_themes()}


@router.post("")
async def install_theme(file: UploadFile = File(...)) -> dict:
    data = await file.read()
    try:
        meta = theme_service.install(data)
    except ThemeError as e:
        # 400, not 500: a rejected package is the user's file being
        # wrong, not the server failing, and the message is written to
        # be shown to them.
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "theme": meta}


@router.get("/{theme_id}")
def download_theme(theme_id: str) -> Response:
    """Download the package back out - so a theme installed here can be
    shared with someone else without keeping the original file."""
    try:
        data = theme_service.package_bytes(theme_id)
    except ThemeError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{theme_id}.vanos-theme"'},
    )


@router.get("/{theme_id}/assets/{asset_path:path}")
def theme_asset(theme_id: str, asset_path: str) -> Response:
    """Stream one image out of a package.

    The Content-Type comes from the service's allow-list, never from the
    request, so a caller cannot influence how the browser interprets the
    bytes. SVG is served as a file for an <img> to load - the frontend
    never inlines it - so scripts inside an SVG cannot execute.
    """
    try:
        data, mime = theme_service.asset(theme_id, asset_path)
    except ThemeError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return Response(
        content=data,
        media_type=mime,
        headers={
            # Package contents are immutable for a given theme id+path,
            # so this can be cached hard. Re-uploading a theme changes
            # the bytes under the same URL, hence the modest max-age
            # rather than "immutable".
            "Cache-Control": "public, max-age=3600",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/{theme_id}")
def delete_theme(theme_id: str) -> dict:
    try:
        theme_service.delete(theme_id)
    except ThemeError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"ok": True}


@router.get("/limits/info")
def limits() -> dict:
    return {"maxPackageBytes": MAX_PACKAGE_BYTES}
