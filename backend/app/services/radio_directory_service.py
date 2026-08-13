"""
RadioDirectoryService — searches the Radio Browser community directory
(api.radio-browser.info) for streamable internet radio stations, UK by
default. A genuinely public, purpose-built API for exactly this - not
a scrape or reverse-engineered protocol (the same distinction already
drawn for Park4Night/Pitchup in the Nearby feature: those had no public
read API and were ruled out; this one is built for exactly this use).

No API key. Multiple mirror servers exist specifically because any one
can go down - their own docs say never hardcode a single server. Full
DNS-based discovery (resolving all.api.radio-browser.info) is the
"correct" approach but adds real complexity for a hobby project; a
short ordered list of known mirrors, tried in turn until one answers,
gets the same resilience with a fraction of the code - same spirit as
the reverse-geocode close-radius-then-wide-radius fallback already used
in coverage_service.py.

Stations returned here feed straight into the SAME internet_radio_service
play() endpoint already built for Battery Bar - this service only finds
URLs, it doesn't play anything itself.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger("vanos.radio_directory_service")

# Tried in order; first one that answers wins. Radio Browser's own docs
# list these (and others) as "example working servers" - never promised
# permanent, which is exactly why this is a list, not a constant.
MIRROR_HOSTS = [
    "https://de1.api.radio-browser.info",
    "https://de2.api.radio-browser.info",
    "https://fr1.api.radio-browser.info",
    "https://at1.api.radio-browser.info",
]

# Requested by Radio Browser's own docs - a descriptive User-Agent helps
# them reach out about API usage/changes, and costs nothing to send.
USER_AGENT = "VanOS-BongoControl/1.0 (self-hosted campervan control app)"

DEFAULT_COUNTRY_CODE = "GB"
REQUEST_TIMEOUT_SECONDS = 6


class RadioDirectoryUnavailableError(RuntimeError):
    pass


class RadioDirectoryService:
    async def search(
        self,
        query: str | None = None,
        country_code: str = DEFAULT_COUNTRY_CODE,
        limit: int = 60,
    ) -> list[dict[str, Any]]:
        """Returns stations ordered by click count (popularity) - a
        reasonable default for "what would show up on a DAB dial",
        matching the feature's own framing. hidebroken=true filters out
        stations Radio Browser's own periodic checks have already found
        dead, so the list isn't full of streams that just won't play.
        """
        params: dict[str, Any] = {
            "countrycode": country_code,
            "limit": limit,
            "hidebroken": "true",
            "order": "clickcount",
            "reverse": "true",
        }
        if query and query.strip():
            params["name"] = query.strip()

        last_error: Exception | None = None
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS, headers={"User-Agent": USER_AGENT}) as client:
            for host in MIRROR_HOSTS:
                try:
                    response = await client.get(f"{host}/json/stations/search", params=params)
                    response.raise_for_status()
                    return [self._normalise(s) for s in response.json()]
                except (httpx.HTTPError, ValueError) as e:  # noqa: PERF203 - a handful of mirrors, not a hot loop
                    last_error = e
                    logger.warning("Radio directory: mirror %s failed (%s), trying next", host, e)
                    continue

        raise RadioDirectoryUnavailableError(f"No Radio Browser mirror responded: {last_error}")

    @staticmethod
    def _normalise(station: dict[str, Any]) -> dict[str, Any]:
        """Only the fields the frontend actually renders - the raw API
        response carries dozens of internal/geo/vote fields nobody
        asked for. url_resolved (redirect-followed) is preferred over
        the raw url field per Radio Browser's own guidance - fewer dead
        links from stations that moved their stream since being listed.
        """
        return {
            "uuid": station.get("stationuuid"),
            "name": station.get("name") or "Unnamed station",
            "url": station.get("url_resolved") or station.get("url") or "",
            "favicon": station.get("favicon") or None,
            "tags": [t for t in (station.get("tags") or "").split(",") if t],
            "bitrate": station.get("bitrate") or None,
            "codec": station.get("codec") or None,
        }

    async def register_click(self, station_uuid: str) -> None:
        """Courtesy call - Radio Browser's docs specifically ask apps to
        call this whenever a user actually plays a station, so their
        popularity/click stats reflect real listening. Best-effort only:
        never raises, never blocks play() waiting for it to finish -
        this is bookkeeping for their community stats, not something
        this app's own playback depends on.
        """
        if not station_uuid:
            return
        try:
            async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS, headers={"User-Agent": USER_AGENT}) as client:
                for host in MIRROR_HOSTS:
                    try:
                        await client.get(f"{host}/json/url/{station_uuid}")
                        return
                    except httpx.HTTPError:
                        continue
        except Exception as e:  # noqa: BLE001 - genuinely best-effort
            logger.debug("Radio directory: click registration failed (harmless): %s", e)


radio_directory_service = RadioDirectoryService()
