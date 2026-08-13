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


class CachedCoverage(Base):
    """Ofcom predicted mobile coverage, cached per postcode.

    Unlike the OSM cache above, the TTL here is a licence condition and
    not just a freshness choice: Ofcom's API terms permit caching for
    performance but require the data isn't retained beyond a month, and
    forbid accumulating it into a dataset. CoverageService.prune_cache()
    enforces that from the shared maintenance loop.

    Stored as JSON rather than 32 columns per operator because the shape
    is Ofcom's, not ours — if they add 5G fields (they already publish
    5G elsewhere), that's a normaliser change, not a migration on a
    live SD card.
    """

    __tablename__ = "cached_coverage"

    # Normalised to upper case with a single space ("LA22 9AN"), so the
    # same place typed three different ways is one cache row and one
    # API call, not three.
    postcode: Mapped[str] = mapped_column(String(10), primary_key=True)
    data_json: Mapped[str] = mapped_column(Text)
    cached_at: Mapped[float] = mapped_column(Float, index=True)


class LocationHistory(Base):
    """Breadcrumb of where the van has been — the basis for the Trips &
    Memories feature.

    Only *accurate* (GPS-source) fixes are logged here; the IP fallback
    is city-level and resolves the ISP, so logging it would draw the
    trail off to whichever town the carrier routes out of. Points are
    logged with a movement/time threshold (see LocationService) so a
    van parked for a week doesn't fill the table with near-identical
    rows — same SD-card-wear discipline as the telemetry history.
    """

    __tablename__ = "location_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timestamp: Mapped[float] = mapped_column(Float, index=True)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(32))


class Place(Base):
    """A named, journaled stop — the layer on top of the raw breadcrumb
    trail (LocationHistory). Detection of *candidate* stops (parked a
    while vs still driving) is computed on demand from LocationHistory
    and never stored - a cluster only becomes a row here once someone
    actually names it. See PlaceService.detect_stays.
    """

    __tablename__ = "places"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    arrived_at: Mapped[float] = mapped_column(Float, index=True)
    # Nullable - a stop still in progress (or a manually-added place with
    # no clear departure) has no departed_at yet.
    departed_at: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[float] = mapped_column(Float)


class RelayEvent(Base):
    """Persisted audit trail of every relay/roof event - the durable
    version of what used to live only in Docker's own stdout log
    (which rotates away on rebuild, the exact gap that turned one
    night's 'why did the light come on' into an hours-long
    investigation). Every field here mirrors what the log lines
    already carry (see relay_service.py/roof_service.py) - this
    doesn't change what's tracked, only where it durably lives.

    channel_id is nullable for events that aren't about one specific
    channel (a full-system startup/shutdown record, for instance).
    """

    __tablename__ = "relay_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timestamp: Mapped[float] = mapped_column(Float, index=True)
    channel_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    channel_name: Mapped[str] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(32))
    detail: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source: Mapped[str] = mapped_column(String(64))
