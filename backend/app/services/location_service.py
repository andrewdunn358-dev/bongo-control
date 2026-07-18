"""
LocationService — holds the van's current location.

Deliberately NOT a Plugin: a hardware plugin autonomously produces its
own telemetry (BLE scanning, etc.), but location here is *pushed* by
the frontend (the phone/tablet's own browser Geolocation API — real
GPS, since that's what's actually in your pocket, not new hardware) via
a REST call, not polled by the backend. A dedicated GPS module plugin
is a plausible future milestone; this covers the phone-assisted case
that works today.

Falls back to IP-based geolocation (approximate — city-level accuracy
at best, sometimes much worse on mobile carrier connections) only when
GPS hasn't been granted/isn't available. The IP lookup is deliberately
called with no target IP, so the geolocation service resolves the
*server's own* outbound public IP — i.e. the van's actual internet
connection, not whichever device happens to be viewing the dashboard
(which matters if you're checking in on it remotely later).
"""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx

from app.services.configuration_service import ConfigurationService

logger = logging.getLogger("vanos.location_service")

IP_GEOLOCATION_URL = "http://ip-api.com/json/"  # free, no key, ~45 req/min


class LocationService:
    def __init__(self, configuration_service: ConfigurationService) -> None:
        self._config = configuration_service

    def get(self) -> dict[str, Any] | None:
        location = self._config.get("location")
        return location if location else None

    def set_from_gps(self, latitude: float, longitude: float) -> dict[str, Any]:
        location = {
            "latitude": latitude,
            "longitude": longitude,
            "source": "gps",
            "updated_at": time.time(),
        }
        self._config.set("location", location)
        return location

    async def refresh_ip_fallback(self) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(IP_GEOLOCATION_URL, params={"fields": "status,lat,lon,city,country"})
            response.raise_for_status()
            data = response.json()

        if data.get("status") != "success":
            raise RuntimeError(f"IP geolocation failed: {data}")

        location = {
            "latitude": data["lat"],
            "longitude": data["lon"],
            "source": "ip_approximate",
            "city": data.get("city"),
            "country": data.get("country"),
            "updated_at": time.time(),
        }
        self._config.set("location", location)
        return location
