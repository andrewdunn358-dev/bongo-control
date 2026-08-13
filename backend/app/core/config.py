"""
Central configuration. All environment-dependent values live here — no
os.environ calls anywhere else in the codebase.

Reads from environment variables (and a local `.env` file if present),
so Docker Compose, systemd, or plain `uvicorn` all configure the app
the same way.
"""

from __future__ import annotations

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "VanOS"
    environment: str = "development"  # development | production
    log_level: str = "INFO"

    # Security: in production the auth gate fails CLOSED when no
    # APP_ACCESS_PASSWORD is set — sensitive/mutating routes refuse to
    # serve rather than exposing relays, roof, camera and location to
    # anyone who reaches the (internet-exposed) app. Set this to true to
    # deliberately run without a password on a trusted LAN-only setup.
    allow_insecure: bool = False

    database_url: str = "sqlite:///./data/vanos.db"

    # Writable data directory. In Docker this is the persistent
    # `vanos-data` volume mounted at /app/data (see docker-compose.yml),
    # so anything written here - the SQLite DB, saved camera snapshots -
    # survives container restarts and rebuilds on the Pi.
    data_dir: str = "./data"

    websocket_history_size: int = 200

    @field_validator("allow_insecure", mode="before")
    @classmethod
    def _blank_is_false(cls, v: object) -> object:
        # docker-compose passes `${VANOS_ALLOW_INSECURE:-}` which is an
        # EMPTY STRING when unset — and pydantic can't parse "" as a bool,
        # which crash-loops the whole backend on boot. Treat blank/None as
        # False so a stray/empty env value can never take the app down.
        if v is None or (isinstance(v, str) and v.strip() == ""):
            return False
        return v

    model_config = SettingsConfigDict(env_file=".env", env_prefix="VANOS_", extra="ignore")


settings = Settings()
