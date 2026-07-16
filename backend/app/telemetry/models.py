"""
Shared telemetry schema.

Every data source in VanOS/Bongo Control — simulation, Victron, battery
shunt, GPS, internet monitor, etc. — publishes messages in this exact
shape onto the TelemetryBus. Nothing downstream (FastAPI routes, the
WebSocket stream, the React frontend) is allowed to know or care which
plugin produced a given reading.

Adding a new hardware plugin later means adding a new `source` value
and a new `domain`'s payload shape — never changing the bus, the API,
or the frontend contract.
"""

from __future__ import annotations

import time
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class TelemetryDomain(str, Enum):
    """Logical category of a telemetry reading. Maps loosely onto the
    dashboard pages (Energy, Battery, Solar, Environment, Connectivity...).
    Note: there is deliberately no Vehicle/OBD domain — this vehicle has
    no OBD port, and coding one would be impractical, so real vehicle
    diagnostics are out of scope rather than left as permanent fake data.
    """

    ENERGY = "energy"
    BATTERY = "battery"
    SOLAR = "solar"
    ENVIRONMENT = "environment"
    CONNECTIVITY = "connectivity"
    SYSTEM = "system"
    NOTIFICATION = "notification"


class TelemetrySource(str, Enum):
    """Which plugin produced this reading. Real hardware plugins get
    added here as they're implemented.
    """

    SIMULATION = "simulation"
    SYSTEM = "system"
    VICTRON_MPPT = "victron_mppt"


class TelemetryMessage(BaseModel):
    """A single envelope published onto the bus.

    `domain` + `payload` is the contract the frontend consumes.
    `source` is metadata for debugging / plugin health, and should
    never be branched on by the UI.
    """

    domain: TelemetryDomain
    source: TelemetrySource
    timestamp: float = Field(default_factory=lambda: time.time())
    payload: dict[str, Any]

    class Config:
        use_enum_values = True
