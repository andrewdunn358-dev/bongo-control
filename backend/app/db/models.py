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
