"""
SQLite database setup.

No production schema yet (per Sprint 1 scope) — this just establishes
the engine/session plumbing so Sprint 5 (history logging) can add
tables without touching app wiring. `Base.metadata.create_all` is
called at startup so it's a no-op today and picks up models automatically
once they're added.
"""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings

# Ensure the sqlite file's parent directory exists (e.g. ./data/)
if settings.database_url.startswith("sqlite:///./"):
    db_path = Path(settings.database_url.replace("sqlite:///./", ""))
    db_path.parent.mkdir(parents=True, exist_ok=True)

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if settings.database_url.startswith("sqlite") else {},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def init_db() -> None:
    """Create tables for any models registered on Base. Safe to call
    repeatedly (no-op if tables already exist).
    """
    Base.metadata.create_all(bind=engine)


def get_db() -> Session:  # pragma: no cover - simple DI helper
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
