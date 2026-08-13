"""
CoverageService — predicted mobile (4G) coverage for somewhere you're
thinking of going, via Ofcom's Connected Nations Mobile API.

WHY THIS EXISTS
The van has no way to know what signal it'll get somewhere it hasn't
been yet. Ofcom publish a per-postcode prediction for all four UK
networks; this turns "shall we go to Wasdale?" into an answer you can
check before you drive there.

THE AWKWARD SHAPE OF IT
Ofcom's API is postcode-in and needs internet. VanOS is coordinate-based
and offline-first. So this is deliberately a *plan-ahead* feature:
you look places up while you have signal, the answers are cached
locally, and they're still there when you're parked in a hole. It is
NOT "what signal do I have right now" — the router already knows that,
and pretending otherwise would be exactly the kind of invented number
this project refuses to show.

CACHING IS CAPPED BY LICENCE, NOT JUST TASTE
Ofcom's API terms permit caching for performance but require the data
is retained no longer than one month, and forbid accumulating it into a
dataset. CACHE_TTL_SECONDS is set under that limit and prune_cache()
enforces it from the same maintenance loop that prunes the POI cache.

ATTRIBUTION
Ofcom require their data be attributed and labelled as *predicted*
coverage wherever it's displayed. The frontend does that; don't strip it.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from collections import Counter
from typing import Any

import httpx

from app.db.database import SessionLocal
from app.db.models import CachedCoverage
from app.services.configuration_service import configuration_service

logger = logging.getLogger("vanos.coverage_service")

OFCOM_BASE = "https://api-proxy.ofcom.org.uk/mobile/coverage/"

# Ofcom allow caching for performance but require retention of no more
# than one month. 27 days keeps us clearly inside that with room for a
# maintenance loop that runs on an interval rather than to the second.
CACHE_TTL_SECONDS = 27 * 86400

# Ofcom's operator prefixes. TF is Telefónica — i.e. O2. These are the
# literal key prefixes in the API response (EEDataOutdoor, H3DataIndoor…).
OPERATORS: dict[str, str] = {
    "EE": "EE",
    "H3": "Three",
    "TF": "O2",
    "VO": "Vodafone",
}

# The four measures Ofcom return per operator. Each also has a "No4g"
# twin (same measure with 4G excluded) which we use to work out whether
# a given rating actually depends on 4G being there.
MEASURES = ("VoiceOutdoor", "VoiceIndoor", "DataOutdoor", "DataIndoor")

# Ofcom's rating scale. 1 and 2 are documented as no longer used, but
# they're mapped anyway so an unexpected value gets a label instead of
# crashing the page.
RATING_LABELS: dict[int, str] = {0: "none", 1: "none", 2: "limited", 3: "limited", 4: "likely"}

# UK postcode, loosely — this only needs to tell "LA22 9AN" apart from
# "Ambleside" so the right lookup path is taken; postcodes.io and Ofcom
# do the real validating. (GIR 0AA deliberately doesn't match: it's a
# single PO-box code with no addresses for Ofcom to predict against, so
# treating it as a place-name search gives a better error than a 404.)
POSTCODE_RE = re.compile(r"^\s*([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\s*$", re.IGNORECASE)

POSTCODES_IO = "https://api.postcodes.io"
NOMINATIM = "https://nominatim.openstreetmap.org/search"

# Ofcom's Basic tier allows 100 requests/minute. Every call here is
# driven by a human tapping Search, so we're nowhere near that — but a
# retry storm or a stuck frontend shouldn't be able to burn the 28-day
# quota either, hence a hard minimum spacing between outbound calls.
MIN_CALL_INTERVAL_S = 0.7


class CoverageError(Exception):
    """Raised with a message intended to be shown to the operator."""


def _normalise_postcode(raw: str) -> str | None:
    """'la229an' / 'LA22  9AN' -> 'LA22 9AN'. None if it isn't a postcode."""
    m = POSTCODE_RE.match(raw or "")
    if not m:
        return None
    return f"{m.group(1).upper()} {m.group(2).upper()}"


def _summarise(values: list[int]) -> dict[str, Any]:
    """Collapse a rating across every address in the postcode.

    A postcode can cover dozens of addresses with different predictions
    (one end of a lane vs the other). Reporting only the best would
    flatter it and only the worst would scare you off, so this reports
    the most common value and flags honestly when they disagree.
    """
    clean = [v for v in values if isinstance(v, int)]
    if not clean:
        return {"value": None, "label": None, "varies": False, "best": None, "worst": None}
    value = Counter(clean).most_common(1)[0][0]
    return {
        "value": value,
        "label": RATING_LABELS.get(value, "unknown"),
        "varies": min(clean) != max(clean),
        "best": max(clean),
        "worst": min(clean),
    }


def _normalise_ofcom(postcode: str, payload: Any) -> dict[str, Any]:
    """Ofcom's response -> the shape the UI actually wants.

    Response is an ARRAY of {PostCode, Availability: [...per-address...]},
    each address carrying 32 flat fields (<OP><Measure>[No4g]). This
    pivots that into per-operator blocks and derives one extra thing
    Ofcom don't state directly: whether a rating *depends* on 4G, which
    is the difference between the plain field and its No4g twin.
    """
    addresses: list[dict[str, Any]] = []
    for block in payload if isinstance(payload, list) else [payload]:
        if isinstance(block, dict):
            addresses.extend(a for a in (block.get("Availability") or []) if isinstance(a, dict))

    if not addresses:
        raise CoverageError(f"Ofcom returned no address-level coverage for {postcode}")

    operators = []
    for key, name in OPERATORS.items():
        measures: dict[str, Any] = {}
        for measure in MEASURES:
            summary = _summarise([a.get(f"{key}{measure}") for a in addresses])
            no4g = _summarise([a.get(f"{key}{measure}No4g") for a in addresses])
            # If the rating drops when 4G is excluded, 4G is what's
            # carrying it here — worth saying, because 3G switch-off
            # means the No4g figure is increasingly theoretical.
            summary["relies_on_4g"] = (
                summary["value"] is not None and no4g["value"] is not None and summary["value"] > no4g["value"]
            )
            summary["without_4g"] = no4g["value"]
            measures[measure] = summary
        operators.append(
            {
                "key": key,
                "name": name,
                "data_outdoor": measures["DataOutdoor"],
                "data_indoor": measures["DataIndoor"],
                "voice_outdoor": measures["VoiceOutdoor"],
                "voice_indoor": measures["VoiceIndoor"],
            }
        )

    return {
        "postcode": postcode,
        "address_count": len(addresses),
        "operators": operators,
    }


class CoverageService:
    def __init__(self) -> None:
        self._call_lock = asyncio.Lock()
        self._last_call_at = 0.0

    # ---------------------------------------------------------------- config

    def api_key(self) -> str:
        key = (configuration_service.get("general", {}) or {}).get("ofcom_api_key")
        return key.strip() if isinstance(key, str) else ""

    def home_network(self) -> str:
        """The operator key ('H3' etc.) whose result gets top billing."""
        value = (configuration_service.get("general", {}) or {}).get("home_network")
        value = value.strip().upper() if isinstance(value, str) else ""
        return value if value in OPERATORS else "H3"

    def configured(self) -> bool:
        return bool(self.api_key())

    def status(self) -> dict[str, Any]:
        return {
            "configured": self.configured(),
            "home_network": self.home_network(),
            "operators": [{"key": k, "name": v} for k, v in OPERATORS.items()],
        }

    # ---------------------------------------------------------------- lookup

    async def lookup(self, query: str, force_refresh: bool = False) -> dict[str, Any]:
        """Search by place name OR postcode, and return coverage for it."""
        query = (query or "").strip()
        if not query:
            raise CoverageError("Type a place name or postcode to check")

        place = await self._resolve(query)
        coverage = await self.coverage_for_postcode(place["postcode"], force_refresh=force_refresh, place=place)
        return {**coverage, "place": place}

    async def lookup_point(self, latitude: float, longitude: float, force_refresh: bool = False) -> dict[str, Any]:
        """Coverage for a coordinate — the van's own fix, or a dropped pin."""
        place = await self._reverse(latitude, longitude)
        coverage = await self.coverage_for_postcode(place["postcode"], force_refresh=force_refresh, place=place)
        return {**coverage, "place": place}

    async def coverage_for_postcode(
        self, postcode: str, force_refresh: bool = False, place: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """Cache-first. Falls back to a stale cache entry when offline
        rather than showing nothing — the same rule the POI cache uses,
        because a month-old prediction is still far better than a blank
        screen when you're parked with no signal.
        """
        normalised = _normalise_postcode(postcode)
        if normalised is None:
            raise CoverageError(f"'{postcode}' doesn't look like a UK postcode")

        cached = await asyncio.to_thread(self._from_cache, normalised)
        if not force_refresh and cached and (time.time() - cached["cached_at"]) < CACHE_TTL_SECONDS:
            # Backfill coordinates onto rows cached before the map view
            # existed (or looked up by a path that had none), so an old
            # entry starts appearing as a pin instead of being stuck as
            # a list row forever. Deliberately does NOT touch cached_at:
            # that clock is a licence obligation, not a freshness hint.
            if place and not cached["data"].get("place"):
                await asyncio.to_thread(self._attach_place, normalised, place)
            return {**cached["data"], "from_cache": True, "cached_at": cached["cached_at"], "stale": False}

        if not self.configured():
            if cached:
                return {**cached["data"], "from_cache": True, "cached_at": cached["cached_at"], "stale": True}
            raise CoverageError("No Ofcom API key set — add one in Settings → Integrations")

        try:
            data = await self._fetch_ofcom(normalised)
        except CoverageError:
            raise
        except Exception as e:  # noqa: BLE001 - no signal is an expected state in a van
            logger.warning("Ofcom coverage fetch failed for %s: %s", normalised, e)
            if cached:
                return {**cached["data"], "from_cache": True, "cached_at": cached["cached_at"], "stale": True}
            raise CoverageError(f"Couldn't reach Ofcom and nothing is cached for {normalised}: {e}") from e

        # Store the coordinates alongside the ratings. Without them a
        # cached lookup can only ever be a list row - it has a postcode
        # but nothing to put a pin on, and re-geocoding it later would
        # need internet, which is exactly what the cache is for.
        if place:
            data = {**data, "place": place}
        await asyncio.to_thread(self._store, normalised, data)
        return {**data, "from_cache": False, "cached_at": time.time(), "stale": False}

    async def _fetch_ofcom(self, postcode: str) -> dict[str, Any]:
        # Ofcom's path parameter wants the postcode without spaces.
        path = postcode.replace(" ", "")
        headers = {
            "Ocp-Apim-Subscription-Key": self.api_key(),
            "Accept": "application/json",
            "User-Agent": configuration_service.user_agent(),
        }

        async with self._call_lock:
            gap = time.monotonic() - self._last_call_at
            if gap < MIN_CALL_INTERVAL_S:
                await asyncio.sleep(MIN_CALL_INTERVAL_S - gap)
            self._last_call_at = time.monotonic()

            async with httpx.AsyncClient(timeout=20.0, headers=headers) as client:
                response = await client.get(f"{OFCOM_BASE}{path}")

        if response.status_code == 401 or response.status_code == 403:
            raise CoverageError("Ofcom rejected the API key — check it in Settings → Integrations")
        if response.status_code == 404:
            raise CoverageError(f"Ofcom has no coverage data for {postcode}")
        if response.status_code == 429:
            raise CoverageError("Ofcom rate limit hit — wait a minute and try again")
        response.raise_for_status()

        return _normalise_ofcom(postcode, response.json())

    # -------------------------------------------------------------- area scan

    async def area(self, latitude: float, longitude: float, radius_m: int = 1500, limit: int = 40) -> dict[str, Any]:
        """A grid of real postcodes around a point, each with its own
        coverage rating - "coverage for wherever you're looking", not
        just the van's own spot.

        Deliberately NOT a blurred/interpolated heatmap: Ofcom's
        prediction only exists per postcode (dozens of addresses on a
        long rural lane collapsed to one rating - see _summarise), so a
        smoothed gradient between sample points would invent confidence
        that isn't there, the same sin the rest of this feature avoids.
        A dense grid of real, individually-rated points is the honest
        version of "looks like a heatmap at a glance".

        Also sidesteps a real landmine: Google's own Maps JS heatmap
        layer (visualization.HeatmapLayer) was deprecated in the
        Maps JS API and removed as of May 2026, so building on it now
        would ship broken. Plain markers work on both renderers and
        don't depend on a feature Google just killed.

        Costs one Ofcom call per NEW postcode in range (already-cached
        ones are free) - `limit` and `radius_m` are capped well below
        anything that could dent the 28-day quota in one tap.
        """
        radius_m = max(100, min(radius_m, 2000))  # postcodes.io's own ceiling for this endpoint
        limit = max(1, min(limit, 100))

        try:
            data = await self._get_json(
                f"{POSTCODES_IO}/postcodes",
                params={"lat": latitude, "lon": longitude, "radius": radius_m, "limit": limit},
            )
        except Exception as e:  # noqa: BLE001
            raise CoverageError(f"Couldn't list postcodes for that area (no internet?): {e}") from e

        hits = data.get("result") or []
        # Postcodes.io returns closest-first; there's no reason to spend
        # an Ofcom call on the same postcode twice if two hits share one
        # (common for tightly-packed urban addresses).
        seen: set[str] = set()
        postcodes: list[dict[str, Any]] = []
        for hit in hits:
            pc = _normalise_postcode(hit.get("postcode") or "") or hit.get("postcode")
            if not pc or pc in seen:
                continue
            seen.add(pc)
            postcodes.append({"postcode": pc, "latitude": hit.get("latitude"), "longitude": hit.get("longitude")})

        if not postcodes:
            return {"centre": {"latitude": latitude, "longitude": longitude}, "radius_m": radius_m, "results": []}

        # Sequential, not gathered concurrently: _fetch_ofcom already
        # serialises real network calls behind _call_lock (see
        # MIN_CALL_INTERVAL_S), so gathering here would just have every
        # task queue up behind that lock anyway - doing it sequentially
        # is simpler and makes a slow/failed postcode fail on its own
        # rather than as part of a batch.
        results = []
        for pc in postcodes:
            try:
                coverage = await self.coverage_for_postcode(pc["postcode"], place=pc)
                results.append({**coverage, "place": pc})
            except CoverageError as e:
                logger.info("Area scan: skipping %s (%s)", pc["postcode"], e)

        return {"centre": {"latitude": latitude, "longitude": longitude}, "radius_m": radius_m, "results": results}

    # ------------------------------------------------------------ geocoding

    async def _resolve(self, query: str) -> dict[str, Any]:
        """Turn what was typed into {postcode, label, lat, lon}.

        A typed postcode is used directly — that path still works with
        no internet if the postcode is already cached, which matters
        because looking up somewhere you're heading is exactly the thing
        you might do with one bar of signal.
        """
        postcode = _normalise_postcode(query)
        if postcode:
            place = {"label": postcode, "postcode": postcode, "latitude": None, "longitude": None, "source": "postcode"}
            try:
                data = await self._get_json(f"{POSTCODES_IO}/postcodes/{postcode.replace(' ', '')}")
                result = data.get("result") or {}
                place["latitude"] = result.get("latitude")
                place["longitude"] = result.get("longitude")
                label_parts = [result.get("parish") or result.get("admin_ward"), result.get("admin_district")]
                pretty = ", ".join(p for p in label_parts if p)
                place["label"] = f"{pretty} ({postcode})" if pretty else postcode
            except Exception as e:  # noqa: BLE001 - coordinates are a nicety, the postcode is the payload
                logger.info("Postcode geocode failed for %s (%s) - continuing without coordinates", postcode, e)
            return place

        # A place name. postcodes.io's /places is Ordnance Survey Open
        # Names — GB-only, which is exactly right here — then reverse the
        # centroid to its nearest postcode for the Ofcom call.
        try:
            data = await self._get_json(f"{POSTCODES_IO}/places", params={"q": query, "limit": 1})
            results = data.get("result") or []
        except Exception as e:  # noqa: BLE001
            logger.info("postcodes.io place search failed (%s) - trying Nominatim", e)
            results = []

        if results:
            hit = results[0]
            latitude, longitude = hit.get("latitude"), hit.get("longitude")
            label_parts = [hit.get("name_1"), hit.get("county_unitary") or hit.get("region")]
            label = ", ".join(p for p in label_parts if p) or query
        else:
            latitude, longitude, label = await self._nominatim(query)

        if latitude is None or longitude is None:
            raise CoverageError(f"Couldn't find anywhere in the UK called '{query}'")

        reverse = await self._reverse(latitude, longitude)
        return {
            "label": label,
            "postcode": reverse["postcode"],
            "latitude": latitude,
            "longitude": longitude,
            "source": "place",
        }

    async def _reverse(self, latitude: float, longitude: float) -> dict[str, Any]:
        """Nearest postcode to a coordinate.

        Ofcom's data only exists per postcode, so a rural pin gets the
        nearest one — which can be a mile away. `postcode_distance_m` is
        returned so the UI can say that out loud rather than implying
        the prediction is for the exact spot.

        Two passes on purpose: postcodes.io caps `radius` at 2 km, which
        misses exactly the places this feature is for (a layby on a
        moor, a forestry track). When the close search comes back empty
        we retry with `wideSearch`, which reaches 20 km — slower and
        capped at 10 results, so it isn't worth doing first.
        """
        base = {"lat": latitude, "lon": longitude, "limit": 1}
        try:
            data = await self._get_json(f"{POSTCODES_IO}/postcodes", params={**base, "radius": 2000})
            results = data.get("result") or []
            if not results:
                data = await self._get_json(f"{POSTCODES_IO}/postcodes", params={**base, "wideSearch": "true"})
                results = data.get("result") or []
        except Exception as e:  # noqa: BLE001
            raise CoverageError(f"Couldn't look up the postcode for that spot (no internet?): {e}") from e

        if not results:
            raise CoverageError("No UK postcode within 20 km of that point — Ofcom data is UK-only")

        hit = results[0]
        postcode = _normalise_postcode(hit.get("postcode") or "") or hit.get("postcode")
        label_parts = [hit.get("parish") or hit.get("admin_ward"), hit.get("admin_district")]
        pretty = ", ".join(p for p in label_parts if p)
        return {
            "label": f"{pretty} ({postcode})" if pretty else str(postcode),
            "postcode": str(postcode),
            "latitude": latitude,
            "longitude": longitude,
            "postcode_distance_m": hit.get("distance"),
            "source": "point",
        }

    async def _nominatim(self, query: str) -> tuple[float | None, float | None, str]:
        try:
            data = await self._get_json(
                NOMINATIM,
                params={"q": query, "format": "jsonv2", "countrycodes": "gb", "limit": 1},
            )
        except Exception as e:  # noqa: BLE001
            logger.info("Nominatim lookup failed for %s: %s", query, e)
            return None, None, query
        if not data:
            return None, None, query
        hit = data[0]
        return float(hit["lat"]), float(hit["lon"]), hit.get("display_name", query).split(",")[0]

    async def _get_json(self, url: str, params: dict[str, Any] | None = None) -> Any:
        headers = {"User-Agent": configuration_service.user_agent(), "Accept": "application/json"}
        async with httpx.AsyncClient(timeout=15.0, headers=headers) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            return response.json()

    # ---------------------------------------------------------------- cache

    def _from_cache(self, postcode: str) -> dict[str, Any] | None:
        db = SessionLocal()
        try:
            row = db.query(CachedCoverage).filter(CachedCoverage.postcode == postcode).one_or_none()
            if row is None:
                return None
            return {"data": json.loads(row.data_json), "cached_at": row.cached_at}
        except Exception as e:  # noqa: BLE001 - a corrupt cache row must not break the lookup
            logger.warning("Failed to read cached coverage for %s: %s", postcode, e)
            return None
        finally:
            db.close()

    def _store(self, postcode: str, data: dict[str, Any]) -> None:
        db = SessionLocal()
        try:
            db.merge(CachedCoverage(postcode=postcode, data_json=json.dumps(data), cached_at=time.time()))
            db.commit()
        except Exception as e:  # noqa: BLE001 - caching is best-effort, never fatal
            logger.warning("Failed to cache coverage for %s: %s", postcode, e)
            db.rollback()
        finally:
            db.close()

    def _attach_place(self, postcode: str, place: dict[str, Any]) -> None:
        """Add coordinates to an existing cache row without resetting its
        age. Separate from _store precisely so the TTL clock - which
        Ofcom's terms cap, see CACHE_TTL_SECONDS - can't be restarted by
        something as incidental as looking at the map.
        """
        db = SessionLocal()
        try:
            row = db.query(CachedCoverage).filter(CachedCoverage.postcode == postcode).one_or_none()
            if row is None:
                return
            data = json.loads(row.data_json)
            if data.get("place"):
                return
            data["place"] = place
            row.data_json = json.dumps(data)
            db.commit()
        except Exception as e:  # noqa: BLE001 - best-effort, never fatal
            logger.warning("Failed to attach place to cached coverage for %s: %s", postcode, e)
            db.rollback()
        finally:
            db.close()

    def recent(self, limit: int = 12) -> list[dict[str, Any]]:
        """Recently looked-up postcodes, newest first.

        This is the offline half of the feature: whatever you checked
        while you had signal is still readable when you don't.
        """
        db = SessionLocal()
        try:
            rows = db.query(CachedCoverage).order_by(CachedCoverage.cached_at.desc()).limit(limit).all()
            out = []
            for row in rows:
                try:
                    out.append({**json.loads(row.data_json), "cached_at": row.cached_at, "from_cache": True})
                except (json.JSONDecodeError, TypeError):
                    continue
            return out
        except Exception as e:  # noqa: BLE001
            logger.warning("Failed to read recent coverage lookups: %s", e)
            return []
        finally:
            db.close()

    def prune_cache(self) -> None:
        """Evict entries past the TTL.

        Not just housekeeping: Ofcom's terms require their data isn't
        retained beyond a month, so this is a licence obligation as much
        as an SD-card one. Called from the history service's maintenance
        loop alongside the POI and AI caches.
        """
        cutoff = time.time() - CACHE_TTL_SECONDS
        db = SessionLocal()
        try:
            deleted = db.query(CachedCoverage).filter(CachedCoverage.cached_at < cutoff).delete()
            db.commit()
            if deleted:
                logger.info("Pruned %d cached coverage rows past TTL", deleted)
        except Exception as e:  # noqa: BLE001 - maintenance must never crash the loop
            logger.warning("Failed to prune coverage cache: %s", e)
            db.rollback()
        finally:
            db.close()


coverage_service = CoverageService()
