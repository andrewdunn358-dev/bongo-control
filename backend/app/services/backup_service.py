"""
BackupService — export/import of the two files that make this install
*this* van's VanOS rather than a blank one: the config (relay names,
GPIO map, plugin settings, WiFi, integrations - everything in
data/config.json) and the SQLite database (telemetry/location/POI/
places history in data/vanos.db).

Restore replaces both files on disk and then deliberately exits the
process - the container's `restart: unless-stopped` policy brings it
straight back up reading the restored files fresh. That's simpler and
safer than trying to hot-swap a live SQLite connection out from under
SQLAlchemy's connection pool while the app keeps running.
"""

from __future__ import annotations

import io
import logging
import os
import shutil
import threading
import time
import zipfile
from pathlib import Path

logger = logging.getLogger("vanos.backup")

# Relative to the container's WORKDIR (/app) - same convention as
# ConfigurationService's own default path and settings.database_url.
DATA_DIR = Path("data")
CONFIG_FILENAME = "config.json"
DB_FILENAME = "vanos.db"
# WAL-mode sidecar files don't exist today (this app uses SQLite's
# default rollback-journal mode) but are included defensively in case
# that ever changes - a restore without them would silently lose
# not-yet-checkpointed writes.
_DATA_FILENAMES = [CONFIG_FILENAME, DB_FILENAME, f"{DB_FILENAME}-wal", f"{DB_FILENAME}-shm"]


class BackupError(Exception):
    """Raised for any backup/restore failure that should reach the
    caller as a clear message rather than a raw exception."""


class BackupService:
    def build_zip(self) -> bytes:
        buf = io.BytesIO()
        found_any = False
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for filename in _DATA_FILENAMES:
                path = DATA_DIR / filename
                if path.exists():
                    zf.write(path, arcname=filename)
                    found_any = True
            zf.writestr("MANIFEST.txt", f"VanOS backup\ncreated_at={time.time()}\n")
        if not found_any:
            raise BackupError("Nothing to back up yet - no config.json or vanos.db found.")
        return buf.getvalue()

    def restore_zip(self, data: bytes) -> None:
        try:
            zf = zipfile.ZipFile(io.BytesIO(data))
        except zipfile.BadZipFile as e:
            raise BackupError("That doesn't look like a VanOS backup (not a valid zip file).") from e

        names = set(zf.namelist())
        if CONFIG_FILENAME not in names and DB_FILENAME not in names:
            raise BackupError("That zip doesn't contain a VanOS config.json or vanos.db - wrong file?")

        DATA_DIR.mkdir(parents=True, exist_ok=True)

        # Safety net: keep whatever's currently on disk as .bak rather
        # than overwriting blind, in case the upload turns out to be bad
        # in some way that only shows up after the restart below.
        for filename in _DATA_FILENAMES:
            current = DATA_DIR / filename
            if current.exists():
                shutil.copy2(current, DATA_DIR / f"{filename}.bak")

        for filename in _DATA_FILENAMES:
            if filename in names:
                with zf.open(filename) as src, open(DATA_DIR / filename, "wb") as dst:
                    shutil.copyfileobj(src, dst)

        logger.warning("Backup restored - restarting the process so it loads the restored files cleanly.")
        # Delay long enough for the HTTP response to actually reach the
        # client before the process exits; `restart: unless-stopped`
        # brings the container straight back up.
        threading.Timer(1.5, lambda: os._exit(0)).start()


backup_service = BackupService()
