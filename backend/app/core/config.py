"""
Central configuration. All environment-dependent values live here — no
os.environ calls anywhere else in the codebase.

Reads from environment variables (and a local `.env` file if present),
so Docker Compose, systemd, or plain `uvicorn` all configure the app
the same way.
"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "VanOS / Bongo Control"
    environment: str = "development"  # development | production
    log_level: str = "INFO"

    # Set to False once real hardware plugins exist and should take over.
    simulation_mode: bool = True

    database_url: str = "sqlite:///./data/vanos.db"

    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    websocket_history_size: int = 200

    model_config = SettingsConfigDict(env_file=".env", env_prefix="VANOS_", extra="ignore")


settings = Settings()
