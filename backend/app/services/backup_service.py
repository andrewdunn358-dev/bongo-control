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
_HOST_FILES = (
    (
        "/host/boot/config.txt",
        "host/config.txt",
        "not mounted - update docker-compose.yml and redeploy, or copy by hand",
    ),
    (
        "/host/systemd/vanos-heater-agent.service",
        "host/vanos-heater-agent.service",
        "heater agent not installed on this host",
    ),
    (
        "/host/systemd/ustreamer.service",
        "host/ustreamer.service",
        "uStreamer not installed on this host",
    ),
)

_DATA_FILENAMES = [CONFIG_FILENAME, DB_FILENAME, f"{DB_FILENAME}-wal", f"{DB_FILENAME}-shm"]


class BackupError(Exception):
    """Raised for any backup/restore failure that should reach the
    caller as a clear message rather than a raw exception."""


class BackupService:
    def _env_snapshot(self) -> str:
        """Reconstruct the host .env from the process environment.

        The .env file itself is NOT mounted into the container - compose
        reads it and passes the values through as environment variables
        (docker-compose.yml `environment:`). So this is rebuilt from
        os.environ rather than copied, and is labelled as such: a value
        set directly in compose rather than in .env will appear here
        too, which is what you want for rebuilding a card anyway.

        Without this, a restored card comes up with no app password and
        the camera/GPS pointing at the /dev/null defaults - i.e. auth
        failing open and two subsystems silently dead. config.json and
        vanos.db alone are not enough to rebuild a working install.
        """
        keys = (
            "APP_ACCESS_PASSWORD",
            "WEBCAM_DEVICE",
            "GPS_DEVICE",
            "CAMERA_USTREAMER_URL",
            "CAMERA_ROTATION",
            "CAMERA_STREAM_FPS",
            "HEATER_MAC",
            "HEATER_PIN",
            "HEATER_ADAPTER",
            "VANOS_ALLOW_INSECURE",
        )
        lines = [
            "# Reconstructed by VanOS backup from the running environment.",
            "# NOT a copy of .env - compose passes these through as env vars,",
            "# the file itself is never mounted into the container.",
            "# Review before use, then place as .env beside docker-compose.yml.",
            "",
        ]
        for k in keys:
            v = os.environ.get(k)
            if v is not None and v != "":
                lines.append(f"{k}={v}")
            else:
                lines.append(f"# {k}=   (not set on this install)")
        return "\n".join(lines) + "\n"

    def build_zip(self) -> bytes:
        buf = io.BytesIO()
        found_any = False
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for filename in _DATA_FILENAMES:
                path = DATA_DIR / filename
                if path.exists():
                    zf.write(path, arcname=filename)
                    found_any = True
            zf.writestr("env-backup.txt", self._env_snapshot())

            # Host config, via the read-only mounts in docker-compose.yml.
            # These are the files that made a restored card fail silently:
            # without them you get relays energised through boot, no
            # temperature sensors, no heater and a slow camera, and
            # nothing on screen explains why.
            captured: list[str] = []
            missing: list[str] = []
            for src, arcname, why in _HOST_FILES:
                path = Path(src)
                try:
                    if path.is_file():
                        zf.write(path, arcname=arcname)
                        captured.append(f"{arcname}  <- {src}")
                    else:
                        missing.append(f"{arcname}  ({src}) - {why}")
                except OSError as e:
                    missing.append(f"{arcname}  ({src}) - unreadable: {e}")

            zf.writestr(
                "CHECKLIST.txt",
                "VanOS backup - completeness check\n"
                "=================================\n\n"
                "CAPTURED:\n"
                + ("".join(f"  [x] {c}\n" for c in captured) or "  (none)\n")
                + "\nNOT CAPTURED - these must be handled by hand:\n"
                + ("".join(f"  [ ] {m}\n" for m in missing) or "  (nothing missing)\n")
                + "\nIf anything is listed as NOT CAPTURED, a card restored from this\n"
                  "backup alone will be incomplete. See RESTORE.txt for what each\n"
                  "file does and what breaks without it.\n",
            )
            zf.writestr(
                "RESTORE.txt",
                "VanOS restore\n"
                "=============\n\n"
                "In this zip:\n"
                "  config.json     relay names, roof isolate_channels, Victron MACs +\n"
                "                  encryption keys, all API keys\n"
                "  vanos.db        telemetry, location history, places\n"
                "  env-backup.txt  rebuilt from the running environment - see inside\n\n"
                "Restore config.json + vanos.db through Settings -> Backup -> Restore.\n"
                "Place env-backup.txt as .env beside docker-compose.yml by hand.\n\n"
                "  host/config.txt          boot settings - see below\n"
                "  host/*.service           systemd units - see below\n"
                "  CHECKLIST.txt            what was and was not captured\n\n"
                "READ CHECKLIST.txt FIRST. If it lists anything as NOT CAPTURED,\n"
                "this backup is incomplete and a restored card will not fully work.\n\n"
                "HOST FILES - restore cannot write these (the container mounts them\n"
                "read-only, by design). Place them by hand on the new card:\n\n"
                "  host/config.txt  ->  /boot/firmware/config.txt\n"
                "      Must contain these two lines, then reboot:\n"
                "        gpio=17,27,22,23,16,26,12,13=op,dl\n"
                "            SAFETY - without it the relays energise for the whole\n"
                "            boot window. op,dl = drive LOW; the board is HIGH-trigger.\n"
                "        dtoverlay=w1-gpio\n"
                "            without it there are no temperature sensors at all\n\n"
                "  host/vanos-heater-agent.service  ->  /etc/systemd/system/\n"
                "      sudo pip3 install bleak bleak-retry-connector \\\n"
                "           diesel-heater-ble --break-system-packages\n"
                "      sudo systemctl enable --now vanos-heater-agent\n"
                "      Without it: heater shows No signal, permanently.\n\n"
                "  host/ustreamer.service  ->  /etc/systemd/system/\n"
                "      sudo apt install -y ustreamer\n"
                "      sudo systemctl enable --now ustreamer\n"
                "      Without it: camera falls back to ffmpeg, ~4s per frame.\n\n"
                "CONTAINS SECRETS. Do not commit to git.\n",
            )
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
