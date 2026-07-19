"""
Persisted telemetry history (Milestone 5).

One generic table for every domain rather than a table per domain —
matches the bus's own generic TelemetryMessage shape (domain, source,
timestamp, payload), so adding a new domain later needs no schema
migration, same philosophy as the Telemetry Bus itself.

This is NOT a 1:1 log of every message published — see
HistoryService for why (SD-card write volume) and how sampling works.
"""

from __future__ import annotations

from sqlalchemy import Float, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class TelemetryReading(Base):
    __tablename__ = "telemetry_readings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    domain: Mapped[str] = mapped_column(String(32), index=True)
    source: Mapped[str] = mapped_column(String(32))
    timestamp: Mapped[float] = mapped_column(Float, index=True)
    payload_json: Mapped[str] = mapped_column(Text)

    __table_args__ = (Index("ix_domain_timestamp", "domain", "timestamp"),)


class CachedPoi(Base):
    """Locally cached OpenStreetMap POIs.

    OSM data is ODbL-licensed, which explicitly permits caching — this
    is what makes offline POI lookup possible at all (Google's Places
    terms forbid it). For a campervan that regularly has no signal,
    being able to find the nearest dump station without a connection is
    arguably the whole point of the feature.
    """

    __tablename__ = "cached_pois"

    osm_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category: Mapped[str] = mapped_column(String(32), index=True)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    latitude: Mapped[float] = mapped_column(Float, index=True)
    longitude: Mapped[float] = mapped_column(Float, index=True)
    opening_hours: Mapped[str | None] = mapped_column(String(255), nullable=True)
    fee: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Not every OSM entry has these — many campsites/dump stations are
    # mapped with just a location and a name. Shown when present, left
    # out of the UI entirely when not, same "don't invent it" rule as
    # everywhere else in this app.
    address: Mapped[str | None] = mapped_column(String(400), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    website: Mapped[str | None] = mapped_column(String(400), nullable=True)
    cached_at: Mapped[float] = mapped_column(Float)


class PoiFetchLog(Base):
    """Record of which areas have been fetched, so we can tell the
    difference between "no POIs of that type nearby" and "never looked
    here" — without this, an empty cache is indistinguishable from a
    genuinely empty area.
    """

    __tablename__ = "poi_fetch_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    radius_m: Mapped[int] = mapped_column(Integer)
    fetched_at: Mapped[float] = mapped_column(Float, index=True)


class CachedAiRecommendations(Base):
    """Cached AI-generated 'cool stuff nearby' recommendations.

    This calls a paid LLM API per genuinely-new location, unlike the
    free OSM-backed POI cache above - caching aggressively here isn't
    just a performance nicety, it's the main safeguard against
    unnecessary API cost. "What's interesting near here" doesn't change
    day to day, so a long TTL (see ai_recommendations_service.py) costs
    nothing in usefulness.
    """

    __tablename__ = "cached_ai_recommendations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    latitude: Mapped[float] = mapped_column(Float, index=True)
    longitude: Mapped[float] = mapped_column(Float, index=True)
    place_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    recommendations_json: Mapped[str] = mapped_column(Text)
    model_used: Mapped[str] = mapped_column(String(64))
    cached_at: Mapped[float] = mapped_column(Float)
