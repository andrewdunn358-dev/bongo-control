"""
SnapshotStore — persists camera snapshots to disk on the Pi.

Snapshots used to live only in the browser's React state, so they
vanished on every reload and were never really "saved" anywhere. They
now land as ordinary .jpg files under the persistent data volume
(settings.data_dir/snapshots), which on the Pi is the Docker
`vanos-data` volume - so they survive restarts and rebuilds and can be
managed (listed, deleted) from the dashboard.

Filenames encode capture time (snap-YYYYMMDD-HHMMSS-mmm.jpg) and double
as the opaque `id` used by the API. Every id coming from a client is
validated against a strict pattern AND confirmed to resolve inside the
snapshots directory before any filesystem access, so a crafted id like
"../../etc/passwd" can't escape the folder.

A soft cap (MAX_SNAPSHOTS) trims the oldest files on save - an SD card
is small and this app already goes out of its way not to wear one out,
so an unbounded snapshot pile would be a foot-gun. Manual deletion from
the UI is still the primary path; the cap is just a backstop.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from pathlib import Path

from app.core.config import settings

logger = logging.getLogger("vanos.snapshot_store")

# id == filename stem, e.g. "snap-20260722-134501-042"
ID_PATTERN = re.compile(r"^snap-\d{8}-\d{6}-\d{3}$")
MAX_SNAPSHOTS = 200


class SnapshotError(RuntimeError):
    pass


class SnapshotStore:
    def __init__(self) -> None:
        self._dir = Path(settings.data_dir) / "snapshots"

    def _ensure_dir(self) -> Path:
        self._dir.mkdir(parents=True, exist_ok=True)
        return self._dir

    def _path_for(self, snapshot_id: str) -> Path:
        """Validated path for an id, or raise. Guards against traversal:
        the id must match the strict pattern AND the resolved path must
        still live inside the snapshots directory.
        """
        if not ID_PATTERN.match(snapshot_id):
            raise SnapshotError("Invalid snapshot id")
        base = self._ensure_dir().resolve()
        path = (base / f"{snapshot_id}.jpg").resolve()
        if base not in path.parents:
            raise SnapshotError("Invalid snapshot id")
        return path

    def save(self, jpeg_bytes: bytes) -> dict:
        if not jpeg_bytes:
            raise SnapshotError("Empty snapshot")
        directory = self._ensure_dir()
        # Millisecond precision keeps ids unique even on rapid taps.
        now = datetime.now()
        snapshot_id = f"snap-{now:%Y%m%d-%H%M%S}-{now.microsecond // 1000:03d}"
        path = directory / f"{snapshot_id}.jpg"
        path.write_bytes(jpeg_bytes)
        self._trim()
        return {"id": snapshot_id, "at": path.stat().st_mtime}

    def list(self) -> list[dict]:
        directory = self._ensure_dir()
        items = []
        for path in directory.glob("snap-*.jpg"):
            if not ID_PATTERN.match(path.stem):
                continue
            items.append({"id": path.stem, "at": path.stat().st_mtime})
        # Newest first.
        items.sort(key=lambda i: i["at"], reverse=True)
        return items

    def read(self, snapshot_id: str) -> bytes:
        path = self._path_for(snapshot_id)
        if not path.exists():
            raise SnapshotError("Snapshot not found")
        return path.read_bytes()

    def delete(self, snapshot_id: str) -> None:
        path = self._path_for(snapshot_id)
        if not path.exists():
            raise SnapshotError("Snapshot not found")
        path.unlink()

    def _trim(self) -> None:
        """Keep only the newest MAX_SNAPSHOTS files."""
        try:
            paths = sorted(
                self._dir.glob("snap-*.jpg"),
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )
            for stale in paths[MAX_SNAPSHOTS:]:
                stale.unlink(missing_ok=True)
        except OSError as e:  # pragma: no cover - best-effort housekeeping
            logger.warning("Snapshot trim failed: %s", e)


snapshot_store = SnapshotStore()
