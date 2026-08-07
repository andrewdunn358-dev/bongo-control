"""
SQLite database setup.

No production schema yet (per Sprint 1 scope) — this just establishes
the engine/session plumbing so Sprint 5 (history logging) can add
tables without touching app wiring. `Base.metadata.create_all` is
called at startup so it's a no-op today and picks up models automatically
once they're added.
"""

from __future__ import annotations

import logging
from pathlib import Path

from sqlalchemy import create_engine, inspect as sa_inspect
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings

logger = logging.getLogger("vanos.db")

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
    from app.db import models  # noqa: F401 - import registers models with Base.metadata

    _migrate_poi_cache_schema()
    Base.metadata.create_all(bind=engine)
    _ensure_additive_columns()


def _ensure_additive_columns() -> None:
    """Lightweight forward migration for ADDITIVE schema changes.

    create_all() creates missing tables but never adds a new column to a
    table already on disk — so adding a field to a KEPT table
    (telemetry_readings, location_history) would otherwise break inserts
    on every existing SD card, with no drop-and-refetch escape because
    that data is irreplaceable. This walks the models and issues
    `ALTER TABLE ... ADD COLUMN` for any column missing from an existing
    table. New columns are added nullable (no NOT NULL/default needed for
    existing rows), which covers the additive case safely without pulling
    in a full migration framework. Non-additive changes (renames, type
    changes, drops) still need a real migration — documented, not hidden.
    """
    insp = sa_inspect(engine)
    existing_tables = set(insp.get_table_names())
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if table.name not in existing_tables:
                continue  # create_all just built it with the full schema
            have = {col["name"] for col in insp.get_columns(table.name)}
            for column in table.columns:
                if column.name in have:
                    continue
                coltype = column.type.compile(dialect=engine.dialect)
                conn.exec_driver_sql(f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {coltype}')
                logger.info("Migration: added missing column %s.%s (%s)", table.name, column.name, coltype)


def _migrate_poi_cache_schema() -> None:
    """create_all() only creates tables that don't exist yet - it never
    adds new columns to a table already on disk. Adding address/phone/
    website to CachedPoi means any existing deployment's SQLite file has
    an old-shaped cached_pois table that would fail on the first insert
    referencing those columns.

    There's no migration framework in this project yet, and building one
    just for this would be overkill: cached_pois is disposable, re-
    fetchable data (30-day TTL against a free public API), not
    irreplaceable user data. So the pragmatic fix is: detect the old
    schema and drop it, forcing one re-fetch from Overpass rather than
    erroring forever. poi_fetch_log is dropped alongside it - keeping a
    fetch-log entry pointing at a wiped POI table would make Nearby
    think an area is already covered when it isn't.
    """
    with engine.connect() as conn:
        existing_columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(cached_pois)").fetchall()}
        if existing_columns and "address" not in existing_columns:
            conn.exec_driver_sql("DROP TABLE IF EXISTS cached_pois")
            conn.exec_driver_sql("DROP TABLE IF EXISTS poi_fetch_log")
            conn.commit()


def get_db() -> Session:  # pragma: no cover - simple DI helper
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
