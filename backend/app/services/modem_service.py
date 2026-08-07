"""
Huawei B525 modem signal — measured 4G, not predicted.

The Pi connects to the van's Huawei B525 router over WiFi (its own LAN,
not the Pi's WiFi hotspot for the in-van tablet), so it can read the
router's HiLink API directly. This is a different thing entirely from
the WiFi bars VanOS already shows elsewhere in the app — those are the
Pi<->router link. Nothing before this reads the modem's actual mobile
signal.

THE HOST IS NOT HARDCODED. 192.168.8.1 is Huawei's factory default, but
it's genuinely just a default — changing the router's own DHCP range
(as Andrew did) moves the router's own address too, and there's no way
for this service to know that on its own. So: `general.modem_host` in
config, settable in Settings, is checked first; if that's unset this
falls back to the Pi's own default gateway (`ip route`), which is
usually the router regardless of what subnet it's been reconfigured to
— a much better guess than a hardcoded factory address. If even that's
wrong for some setup, that's exactly what the config field is for.

Uses the `huawei-lte-api` package rather than hand-rolling the
session/token dance — it's tested by its maintainers against the
B525s-65a specifically: https://github.com/Salamek/huawei-lte-api

DIAGNOSTIC-ONLY for now. This exposes the raw `device/signal` reading
so it can be confirmed against the real router before anything is built
on top of it — a GPS-tagged signal log and a measured-coverage heatmap
on the map are the next step (see trip-log-milestone.md / the
offline-maps-m10.md coverage notes), but field names and behaviour
should be confirmed against a live B525 first rather than assumed.
"""

from __future__ import annotations

import asyncio
import logging
import subprocess
import warnings
from typing import Any

import requests
import urllib3
from huawei_lte_api.Client import Client
from huawei_lte_api.Connection import Connection
from huawei_lte_api.exceptions import ResponseErrorException

from app.services.configuration_service import configuration_service

logger = logging.getLogger("vanos.modem")

FACTORY_DEFAULT_HOST = "192.168.8.1"


class ModemError(Exception):
    """Router unreachable, or didn't answer the way a HiLink device should."""


def _default_gateway() -> str | None:
    """The Pi's own default route — usually the router, on whatever
    subnet it's actually been configured to, unlike a hardcoded guess.
    `ip route` ships on every Raspberry Pi OS image; falls back to None
    (caller uses the factory-default guess) if it's ever unavailable."""
    try:
        out = subprocess.run(
            ["ip", "route", "show", "default"], capture_output=True, text=True, timeout=2
        ).stdout
        # "default via 192.168.1.1 dev wlan0 ..."
        parts = out.split()
        if "via" in parts:
            return parts[parts.index("via") + 1]
    except Exception as e:  # noqa: BLE001 - this is a best-effort fallback, never fatal
        logger.info("Could not determine default gateway: %s", e)
    return None


def _read_signal_sync(host: str, username: str | None, password: str | None) -> dict[str, Any]:
    """Runs in a worker thread — huawei-lte-api is synchronous (plain
    `requests` underneath), so this must not run directly on the async
    event loop. Same reason the DB layer got moved to asyncio.to_thread
    (see H1 in code-review-2026-07.md) — a stalled network call here
    would otherwise stall everything else sharing the loop, roof
    watchdog included."""
    url = f"http://{host}/"
    logger.info("Modem signal: connecting to %s%s", host, " (authenticated)" if password else "")

    # Huawei's own firmware redirects the local admin page from the IP
    # to https://hirouter.net - a domain their router's built-in DNS
    # resolves to itself. That domain's certificate has been expired/
    # revoked for years (confirmed by multiple independent reports, and
    # by Home Assistant's own huawei_lte integration hitting the exact
    # same error) with no fix from Huawei - this is a permanent state of
    # the firmware, not a temporary glitch to work around by retrying.
    # Skipping verification here is scoped to exactly this one local
    # connection to a device already trusted by being on the van's own
    # LAN - same reasoning as wifi.py having no auth gate "by design,
    # personal project" - not a blanket "don't verify HTTPS" choice.
    session = requests.Session()
    session.verify = False
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", urllib3.exceptions.InsecureRequestWarning)
        try:
            # username/password are None when nothing's configured -
            # huawei-lte-api only attempts a login if either is truthy,
            # so this stays anonymous exactly like before for routers
            # that don't require it (some HiLink models don't).
            with Connection(url, username=username, password=password, timeout=5, requests_session=session) as connection:
                logger.info("Modem signal: session established with %s, requesting device/signal", host)
                client = Client(connection)
                data = dict(client.device.signal())
                logger.info("Modem signal: got a reading from %s (%d fields)", host, len(data))
                return data
        except ResponseErrorException as e:
            logger.warning("Modem signal: %s rejected the request: %s", host, e)
            hint = " - this router needs a login; set the username/password in Settings" if not password else ""
            raise ModemError(f"Router at {host} responded but rejected the request: {e}{hint}") from e
        except OSError as e:
            logger.warning("Modem signal: could not reach %s: %s", host, e)
            raise ModemError(f"Could not reach the router at {host}: {e}") from e
        except Exception as e:  # noqa: BLE001 - anything else from the library (bad XML,
            # unexpected firmware response, etc) should still come back as a
            # clean error rather than an unhandled 500 / hung connection.
            logger.warning("Modem signal: unexpected error from %s: %s: %s", host, type(e).__name__, e)
            raise ModemError(f"Unexpected error reading the router at {host}: {type(e).__name__}: {e}") from e


class ModemService:
    def _resolve_host_sync(self) -> str:
        """Config wins if set; otherwise the Pi's actual default
        gateway; otherwise Huawei's factory default as a last resort."""
        configured = (configuration_service.get("general", {}) or {}).get("modem_host")
        if isinstance(configured, str) and configured.strip():
            return configured.strip()
        return _default_gateway() or FACTORY_DEFAULT_HOST

    def _resolve_credentials_sync(self) -> tuple[str | None, str | None]:
        """Some HiLink routers (Andrew's B525 included, confirmed by
        the '100003: No rights (needs login)' response) require an
        admin login just to read device/signal; others don't. Only
        attempt a login if a password has actually been set - passing
        username/password to Connection() at all is what triggers
        huawei-lte-api's login attempt, so an unconfigured router stays
        anonymous exactly as before."""
        general = configuration_service.get("general", {}) or {}
        password = general.get("modem_password")
        if not (isinstance(password, str) and password.strip()):
            return None, None
        username = general.get("modem_username")
        username = username.strip() if isinstance(username, str) and username.strip() else "admin"
        return username, password.strip()

    async def resolved_host(self) -> str:
        # Shells out (_default_gateway) with its own bounded timeout,
        # but that still blocks the event loop for however long it
        # takes to get there - the same class of problem H1 (code
        # review) flagged for sync DB calls, and worth avoiding here
        # too since the roof watchdog shares this loop. Always hop to
        # a thread for it.
        return await asyncio.to_thread(self._resolve_host_sync)

    async def signal(self) -> tuple[str, dict[str, Any]]:
        host = await self.resolved_host()
        username, password = await asyncio.to_thread(self._resolve_credentials_sync)
        # Belt and braces on the timeout: _read_signal_sync passes its own
        # timeout down to huawei-lte-api, but that library makes several
        # HTTP calls internally (CSRF/session bootstrap, then the actual
        # device/signal GET) and a bug or an unusual firmware response in
        # any of them could in principle ignore that inner timeout. Since
        # this runs in a worker thread (asyncio.to_thread), a genuine hang
        # there can't be cancelled - but wait_for still lets THIS request
        # give up and return a clean error instead of leaving Cloudflare
        # waiting until its own proxy timeout produces an opaque 520. Same
        # principle as the camera capture timeout fix (M6, code review).
        try:
            data = await asyncio.wait_for(
                asyncio.to_thread(_read_signal_sync, host, username, password), timeout=8.0
            )
            return host, data
        except asyncio.TimeoutError as e:
            raise ModemError(f"No response from {host} within 8s - router unreachable or very slow") from e


modem_service = ModemService()
