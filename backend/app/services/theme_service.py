"""
Theme package storage.

Installed .vanos-theme packages live on the Pi rather than in each
browser, so a theme imported on the desktop is available on the mounted
tablet and the phone without importing it three times. That was the
whole point of a portable format and the first implementation missed
it.

WHAT IS SHARED AND WHAT IS NOT: the set of INSTALLED themes is shared -
it lives here. Which theme a device has SELECTED stays local to that
device, because the tablet may want a bright theme for daylight while
a phone stays dark at night. That is a real preference, not an
oversight.

THIS FILE IS THE AUTHORITY ON WHAT GETS INSTALLED. The browser
validates too, for immediate feedback, but a browser check can be
bypassed and the result here is served to every device on the van. So
the same rules are enforced again, server-side, before anything is
written to disk.

A theme is DATA AND IMAGES ONLY. Nothing in a package is ever executed,
here or in the browser. Assets are streamed back with a fixed
Content-Type from an allow-list, and SVG is served as a file for an
<img> to load - never inlined into a page - so scripts inside an SVG
cannot run.
"""

from __future__ import annotations

import io
import json
import logging
import re
import zipfile
from pathlib import Path
from typing import Any

logger = logging.getLogger("vanos.theme_service")

DATA_DIR = Path("data")
THEMES_DIR = DATA_DIR / "themes"

PACKAGE_FORMAT = "vanos-theme"
SUPPORTED_VERSION = 1

MAX_PACKAGE_BYTES = 8 * 1024 * 1024
MAX_ASSET_BYTES = 2 * 1024 * 1024
MAX_ASSETS = 12
# The Pi runs from an SD card; themes are a convenience and must not be
# able to fill it.
MAX_TOTAL_BYTES = 64 * 1024 * 1024

ASSET_TYPES: dict[str, str] = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
}

# Colour tokens a theme may set. Deliberately excludes the status
# colours and brand orange: those mean charging, attention, fault and
# active-nav, and a theme must not be able to make a fault harder to
# spot.
# Cockpit layouts a theme may choose. Mirrors the frontend registry in
# lib/cockpitThemes.ts. A theme NAMES one of these; it can never supply a
# component or a layout - the same bounded-choice pattern already used
# for fonts. An unknown or absent value falls back to the default, so a
# theme naming a cockpit this build does not have still works.
COCKPIT_LAYOUTS = {"instrument", "adventure", "control"}

THEMEABLE_TOKENS = {
    "ink", "ink-soft", "ink-muted", "ink-faint",
    "surface", "surface-raised", "surface-sunken", "line",
    "aurora-teal", "aurora-blue", "aurora-purple", "aurora-pink",
    "aurora-lime", "aurora-base",
}

_RGB = re.compile(r"^\d{1,3}\s+\d{1,3}\s+\d{1,3}$")
_BACKGROUND = re.compile(r"^(linear-gradient|radial-gradient)\([#\w\s,.%()-]+\)$|^#[0-9a-fA-F]{3,8}$")
_ID = re.compile(r"^[a-z0-9-]{1,48}$")


class ThemeError(Exception):
    """Raised for any failure that should reach the user as a message."""


def _safe_relative(path: str) -> bool:
    """Zip entry names are attacker-controlled. Reject anything that
    could escape the package - classic zip-slip. These names are used to
    build filesystem-adjacent lookups, so a traversal string has no
    legitimate use in a theme."""
    if not path or len(path) > 200 or "\0" in path:
        return False
    if path.startswith("/") or path.startswith("\\") or re.match(r"^[a-zA-Z]:", path):
        return False
    return not any(seg in ("..", ".") for seg in re.split(r"[\\/]", path))


# The Home composition a theme may define. Validated here as well as in
# the frontend because this is the STORE: a package is accepted once and
# then served to every device, so a malformed layout must be refused at
# the door rather than breaking each client in turn.
#
# ALLOCATION INTENT ONLY - widget, span, column. No widths, gaps, pixels
# or any other CSS-ish property; an unknown key is REFUSED rather than
# dropped, so a layout cannot smuggle presentation in and have it
# silently ignored here but honoured somewhere else later.
#
# Widget IDS are deliberately NOT checked against a list here. The
# frontend owns the registry, it changes with the frontend, and a
# backend copy would go stale and start rejecting valid themes. An
# unknown id is skipped client-side with a note, which is the degrade
# path already agreed.
_LAYOUT_ITEM_KEYS = {"widget", "span", "column"}
_LAYOUT_MAX_ITEMS = 24
_LAYOUT_COLUMNS = 12


def _clean_home_layout(home: object) -> dict | None:
    if not isinstance(home, dict):
        return None
    raw = home.get("layout")
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ThemeError("The theme's home layout must be an object.")
    items = raw.get("items")
    if not isinstance(items, list):
        raise ThemeError("The theme's home layout has no \"items\" array.")
    if len(items) > _LAYOUT_MAX_ITEMS:
        raise ThemeError(f"That home layout has too many items ({len(items)}, limit {_LAYOUT_MAX_ITEMS}).")

    clean: list[dict] = []
    for entry in items:
        if not isinstance(entry, dict):
            raise ThemeError("Every home layout item must be an object.")
        unknown = set(entry) - _LAYOUT_ITEM_KEYS
        if unknown:
            raise ThemeError(
                f"\"{sorted(unknown)[0][:20]}\" is not something a layout can set. A layout says what goes "
                "where (widget, span, column); how it is drawn belongs to the renderer."
            )
        widget = entry.get("widget")
        if not isinstance(widget, str) or not widget.strip():
            raise ThemeError("Every home layout item needs a \"widget\".")
        item: dict = {"widget": widget[:40]}
        for key in ("span", "column"):
            if key in entry:
                value = entry[key]
                if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= _LAYOUT_COLUMNS:
                    raise ThemeError(f"\"{key}\" must be a whole number from 1 to {_LAYOUT_COLUMNS}.")
                item[key] = value
        clean.append(item)

    version = raw.get("version")
    return {"version": version if isinstance(version, int) else 1, "items": clean}


def _slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s[:48] or "theme"


def validate_package(data: bytes) -> dict[str, Any]:
    """Validate a .vanos-theme package. Returns its metadata.

    Raises ThemeError with a message meant for a person. Never partially
    accepts: a package is entirely valid or entirely refused.
    """
    if len(data) > MAX_PACKAGE_BYTES:
        raise ThemeError(
            f"That package is too large ({len(data) / 1024 / 1024:.1f}MB, "
            f"limit {MAX_PACKAGE_BYTES // 1024 // 1024}MB)."
        )

    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ThemeError("That isn't a readable .vanos-theme package (bad zip).")

    names = [n for n in zf.namelist() if not n.endswith("/")]
    for n in names:
        if not _safe_relative(n):
            raise ThemeError(f"The package contains an unsafe file path: {n[:60]}")

    # Guard against a zip bomb: a small archive that expands enormously.
    # Checked before reading any member.
    total_uncompressed = sum(zf.getinfo(n).file_size for n in names)
    if total_uncompressed > MAX_PACKAGE_BYTES * 4:
        raise ThemeError("That package expands to an unreasonable size and was refused.")

    if "manifest.json" not in names:
        raise ThemeError("The package has no manifest.json.")

    try:
        manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ThemeError("manifest.json is not valid JSON.")
    if not isinstance(manifest, dict):
        raise ThemeError("manifest.json must be a JSON object.")

    if manifest.get("format") != PACKAGE_FORMAT:
        raise ThemeError("That isn't a VanOS theme package (manifest.format is wrong).")

    version = manifest.get("version")
    if not isinstance(version, int):
        raise ThemeError("The manifest has no version number.")
    if version > SUPPORTED_VERSION:
        raise ThemeError(
            f"This theme needs a newer version of VanOS (package v{version}, "
            f"this build supports v{SUPPORTED_VERSION})."
        )

    name = (manifest.get("name") or "").strip() if isinstance(manifest.get("name"), str) else ""
    if not name:
        raise ThemeError("The manifest has no name.")
    if len(name) > 40:
        raise ThemeError("That theme name is too long (40 characters max).")

    theme_path = manifest.get("theme") or "theme.json"
    if not isinstance(theme_path, str) or not _safe_relative(theme_path):
        raise ThemeError("The manifest points at an unsafe theme path.")
    if theme_path not in names:
        raise ThemeError(f"The package has no {theme_path}.")

    try:
        definition = json.loads(zf.read(theme_path).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ThemeError(f"{theme_path} is not valid JSON.")
    if not isinstance(definition, dict):
        raise ThemeError(f"{theme_path} must be a JSON object.")

    tokens = definition.get("tokens")
    if not isinstance(tokens, dict):
        raise ThemeError("The theme has no tokens object.")

    clean_tokens: dict[str, str] = {}
    for key, value in tokens.items():
        k = key.lstrip("-")
        if k not in THEMEABLE_TOKENS or not isinstance(value, str):
            continue  # unknown tokens are ignored, not fatal
        v = value.strip()
        ok = _BACKGROUND.match(v) if k == "aurora-base" else (
            _RGB.match(v) and all(0 <= int(n) <= 255 for n in v.split())
        )
        if not ok:
            raise ThemeError(
                f'Invalid value for "{k}". Colours must be "R G B" (e.g. "15 41 66").'
            )
        clean_tokens[k] = v
    if not clean_tokens:
        raise ThemeError("The theme sets no usable tokens.")

    assets: list[str] = []
    for n in names:
        if n in ("manifest.json", theme_path) or n.lower().endswith((".md", ".txt")):
            continue
        ext = Path(n).suffix.lower()
        if ext not in ASSET_TYPES:
            raise ThemeError(
                f"The package contains a file type themes may not include: {n[:60]}. "
                "Only png, jpg, webp and svg are allowed."
            )
        if zf.getinfo(n).file_size > MAX_ASSET_BYTES:
            raise ThemeError(f"{n} is too large (limit {MAX_ASSET_BYTES // 1024 // 1024}MB per asset).")
        assets.append(n)

    if len(assets) > MAX_ASSETS:
        raise ThemeError(f"That package has too many assets ({len(assets)}, limit {MAX_ASSETS}).")

    preview = manifest.get("preview")
    if preview and preview not in assets:
        raise ThemeError(f"The manifest names a preview ({preview}) that is not in the package.")

    return {
        "id": _slug(name),
        "name": name,
        "author": (manifest.get("author") or "")[:60] or None,
        "description": (manifest.get("description") or "")[:200] or None,
        "preview": preview or None,
        "formatVersion": version,
        "tokens": clean_tokens,
        "typography": definition.get("typography") if isinstance(definition.get("typography"), dict) else None,
        "shape": definition.get("shape") if isinstance(definition.get("shape"), dict) else None,
        "density": definition.get("density") if isinstance(definition.get("density"), str) else None,
        "assets": definition.get("assets") if isinstance(definition.get("assets"), dict) else None,
        # ONE bounded layout flag, not arbitrary layout control. A theme
        # may say the hero should show its own imagery rather than the
        # live camera - the camera then appears in its own Home tile,
        # which is where it belongs. Anything else in "home" is ignored;
        # general layout variants are still deferred.
        "cockpit": (
            definition["cockpit"]
            if isinstance(definition.get("cockpit"), str) and definition["cockpit"] in COCKPIT_LAYOUTS
            else None
        ),
        "heroCamera": (
            bool(definition["home"]["heroCamera"])
            if isinstance(definition.get("home"), dict) and isinstance(definition["home"].get("heroCamera"), bool)
            else None
        ),
        # The Home COMPOSITION. This is the field that makes a theme able
        # to arrange the page rather than only recolour it.
        "homeLayout": _clean_home_layout(definition.get("home")),
        "assetPaths": assets,
        "sizeBytes": len(data),
    }


class ThemeService:
    def _path(self, theme_id: str) -> Path:
        if not _ID.match(theme_id):
            raise ThemeError("Unknown theme.")
        return THEMES_DIR / f"{theme_id}.vanos-theme"

    def list_themes(self) -> list[dict[str, Any]]:
        if not THEMES_DIR.is_dir():
            return []
        out: list[dict[str, Any]] = []
        for p in sorted(THEMES_DIR.glob("*.vanos-theme")):
            try:
                meta = validate_package(p.read_bytes())
            except (ThemeError, OSError) as e:
                # A file that no longer validates is skipped rather than
                # breaking the whole list - one bad theme must not stop
                # the others loading.
                logger.warning("Skipping unreadable theme %s: %s", p.name, e)
                continue
            meta.pop("assetPaths", None)
            out.append(meta)
        return out

    def install(self, data: bytes) -> dict[str, Any]:
        meta = validate_package(data)
        THEMES_DIR.mkdir(parents=True, exist_ok=True)

        existing = sum(p.stat().st_size for p in THEMES_DIR.glob("*.vanos-theme"))
        target = self._path(meta["id"])
        if target.exists():
            existing -= target.stat().st_size  # replacing, not adding
        if existing + len(data) > MAX_TOTAL_BYTES:
            raise ThemeError(
                "Not enough room for another theme. Remove one first "
                f"(limit {MAX_TOTAL_BYTES // 1024 // 1024}MB total)."
            )

        # Write then rename, so an interrupted upload cannot leave a
        # half-written package that later fails to parse.
        tmp = target.with_suffix(".tmp")
        tmp.write_bytes(data)
        tmp.replace(target)
        logger.info("Installed theme %s (%d bytes)", meta["id"], len(data))
        meta.pop("assetPaths", None)
        return meta

    def package_bytes(self, theme_id: str) -> bytes:
        p = self._path(theme_id)
        if not p.is_file():
            raise ThemeError("Unknown theme.")
        return p.read_bytes()

    def asset(self, theme_id: str, asset_path: str) -> tuple[bytes, str]:
        """Return one asset's bytes and its Content-Type.

        The path is checked against the package's own contents rather
        than trusted, and the media type comes from our allow-list rather
        than from the request - so a request cannot choose how the
        browser interprets the bytes.
        """
        if not _safe_relative(asset_path):
            raise ThemeError("Unknown asset.")
        p = self._path(theme_id)
        if not p.is_file():
            raise ThemeError("Unknown theme.")
        try:
            with zipfile.ZipFile(p) as zf:
                if asset_path not in zf.namelist():
                    raise ThemeError("Unknown asset.")
                mime = ASSET_TYPES.get(Path(asset_path).suffix.lower())
                if not mime:
                    raise ThemeError("Unknown asset.")
                return zf.read(asset_path), mime
        except zipfile.BadZipFile:
            raise ThemeError("That theme package is damaged.")

    def delete(self, theme_id: str) -> None:
        p = self._path(theme_id)
        if not p.is_file():
            raise ThemeError("Unknown theme.")
        p.unlink()
        logger.info("Deleted theme %s", theme_id)


theme_service = ThemeService()
