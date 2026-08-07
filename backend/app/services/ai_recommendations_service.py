"""
AiRecommendationsService — "what's genuinely cool nearby right now",
via Claude (Anthropic API), grounded in the location, a reverse-
geocoded place name, and whatever real nearby places our own OSM POI
cache already knows about.

Deliberately one-shot, not a chat: a single request/response per tap,
not a back-and-forth conversation - keeps this simple and keeps cost
predictable and low (see docs/ai_features.md for real numbers). Called
only when the person explicitly taps a button, never automatically or
on a schedule - unlike telemetry, there's no reason to poll an LLM in
the background, and every call costs real money.

Uses httpx directly against Anthropic's REST API rather than the
official SDK - httpx is already a dependency (weather/POI both use
it), so this avoids adding a whole new package (and its own ARM-wheel
question) for what's a simple POST request.

COST SAFEGUARD: results are cached per rounded location (~1km) for a
week - "what's interesting nearby" doesn't meaningfully change day to
day, so this costs nothing in usefulness but is the actual protection
against re-paying for the same spot on every repeat visit or every
tap of the button.

HONESTY: an LLM can state incorrect details, or in rare cases describe
a place that doesn't quite exist as claimed, with total confidence -
a known limitation of the technology, not a bug in this integration.
Real web search (added after an early real-world miss - the model once
stated a pub was "10 minutes away" that was actually about 40) grounds
this in current sources rather than pure memorized training data,
which helps a lot but doesn't eliminate the risk - search results can
themselves be wrong, and the model can still misjudge which place a
source is actually describing. The prompt explicitly forbids stating
any specific driving time or distance, even one lifted straight from a
source, since a source's stated distance is from its own reference
point, not necessarily this van's exact GPS position. The frontend
labels this content as AI-generated and suggests verifying before
relying on it, the same "don't overstate precision" principle used
for the voltage-only battery estimate elsewhere in this app. Grounding
the prompt with real, already-known OSM places (known_nearby below)
and a real reverse-geocoded place name both further reduce - but don't
eliminate - this risk.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from typing import Any

import httpx

from app.db.database import SessionLocal
from app.services.configuration_service import configuration_service
from app.db.models import CachedAiRecommendations

logger = logging.getLogger("vanos.ai_recommendations_service")

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
# Haiku, deliberately: this is a short, well-defined recommendation
# task, not complex reasoning - the cheapest current model is the
# right fit, not the most capable one. See docs/ai_features.md for the
# actual per-request cost this works out to.
DEFAULT_MODEL = "claude-haiku-4-5-20251001"
MAX_TOKENS = 1500
# Web search adds real latency (the model may run several searches
# before answering, each a live round trip) - the old 20s timeout was
# sized for a single plain text generation and would cut this off
# mid-search on a slower connection.
REQUEST_TIMEOUT_SECONDS = 60.0
# Hard cap on searches per call. Web search costs $10/1,000 searches
# ($0.01 each) ON TOP OF normal token costs - uncapped, a model that
# gets search-happy could multiply the cost of a single tap
# unpredictably. 4 is enough for "check a few real sources", not
# enough to run away.
MAX_SEARCHES_PER_CALL = 4

CACHE_TTL_SECONDS = 7 * 86400
# Coordinates rounded to ~1km before cache lookup/storage - the exact
# GPS fix differs by a few hundred meters between visits to "the same"
# spot; rounding means those still hit the same cache entry rather
# than each triggering a fresh paid call.
CACHE_COORD_PRECISION = 2

NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
# Required by Nominatim's usage policy, and the exact class of bug
# already hit once in this project (see poi_service.py) - a generic
# library User-Agent gets rejected by OSM's own reverse-geocoding
# endpoint just like it did from Overpass.

# Catches "10 minutes", "about 20 minutes' drive northeast", "5 miles
# south", "15-20 minutes drive", etc. - the prompt asks the model not to
# state these, but a cheap/fast model (Haiku) doesn't reliably comply
# with negative instructions, confirmed in practice (a real response
# still said "about 10 minutes south" despite the prompt explicitly
# forbidding it). This is the actual guarantee: strip the claim
# deterministically after the fact, rather than trusting compliance.
_DISTANCE_TIME_PATTERN = re.compile(
    r"\b(?:about|around|roughly|approx\.?|just)?\s*"
    r"\d+(?:-\d+)?\s*"
    r"(?:minutes?|mins?|hours?|hrs?|miles?|mi\b|km|kilometers?)"
    r"(?:'s)?"
    r"(?:\s*(?:'|’)\s*(?:drive|walk|away))?"
    r"(?:\s+(?:drive|walk|away))?"
    r"(?:\s+(?:north|south|east|west)(?:east|west)?)?",
    re.IGNORECASE,
)


def _strip_distance_claims(text: str) -> str:
    cleaned = _DISTANCE_TIME_PATTERN.sub("", text)
    # Tidy up the punctuation/spacing left behind by removing a clause
    # out of the middle of a sentence (double spaces, dangling commas).
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    cleaned = re.sub(r"\s+([,.])", r"\1", cleaned)
    cleaned = re.sub(r",\s*,", ",", cleaned)
    cleaned = re.sub(r"^\s*,\s*", "", cleaned)
    return cleaned.strip().strip(",").strip()


class AiRecommendationsUnavailableError(RuntimeError):
    pass


class AiRecommendationsService:
    @staticmethod
    def _api_key() -> str:
        """API key from Settings (config store) first, then the
        ANTHROPIC_API_KEY env var. Lets each operator enter their own key
        in the UI without editing files, while still honouring .env."""
        cfg = configuration_service.get("general", {}) or {}
        return str(cfg.get("anthropic_api_key") or "").strip() or os.environ.get("ANTHROPIC_API_KEY", "")

    @staticmethod
    def _model() -> str:
        cfg = configuration_service.get("general", {}) or {}
        return str(cfg.get("ai_model") or "").strip() or os.environ.get("AI_RECOMMENDATIONS_MODEL") or DEFAULT_MODEL

    def is_configured(self) -> bool:
        return bool(self._api_key())

    async def get_recommendations(
        self, latitude: float, longitude: float, known_nearby: list[str], force_refresh: bool = False
    ) -> dict[str, Any]:
        api_key = self._api_key()
        if not api_key:
            raise AiRecommendationsUnavailableError(
                "No Anthropic API key set - add one in Settings → Integrations (or via ANTHROPIC_API_KEY)"
            )

        rounded_lat = round(latitude, CACHE_COORD_PRECISION)
        rounded_lon = round(longitude, CACHE_COORD_PRECISION)

        # SQLite work off the event loop (see roof watchdog rationale).
        if not force_refresh:
            cached = await asyncio.to_thread(self._from_cache, rounded_lat, rounded_lon)
            if cached is not None:
                return cached

        place_name = await self._reverse_geocode(latitude, longitude)
        recommendations = await self._call_claude(api_key, latitude, longitude, place_name, known_nearby)
        await asyncio.to_thread(self._store, rounded_lat, rounded_lon, place_name, recommendations)
        return {"place_name": place_name, "recommendations": recommendations, "from_cache": False, "cached_at": None}

    def _from_cache(self, rounded_lat: float, rounded_lon: float) -> dict[str, Any] | None:
        db = SessionLocal()
        try:
            row = (
                db.query(CachedAiRecommendations)
                .filter(CachedAiRecommendations.latitude == rounded_lat, CachedAiRecommendations.longitude == rounded_lon)
                .order_by(CachedAiRecommendations.cached_at.desc())
                .first()
            )
            if row is None or (time.time() - row.cached_at) > CACHE_TTL_SECONDS:
                return None
            return {
                "place_name": row.place_name,
                "recommendations": json.loads(row.recommendations_json),
                "from_cache": True,
                "cached_at": row.cached_at,
            }
        finally:
            db.close()

    def prune_cache(self) -> None:
        """Delete recommendation rows past their TTL — re-generatable on
        demand, so age-based eviction is lossless and keeps the table
        bounded on the SD card."""
        cutoff = time.time() - CACHE_TTL_SECONDS
        db = SessionLocal()
        try:
            deleted = db.query(CachedAiRecommendations).filter(CachedAiRecommendations.cached_at < cutoff).delete()
            db.commit()
            if deleted:
                logger.info("Pruned %d cached AI recommendation rows past TTL", deleted)
        except Exception as e:  # noqa: BLE001 - maintenance must never crash the loop
            logger.warning("Failed to prune AI recommendations cache: %s", e)
            db.rollback()
        finally:
            db.close()

    def _store(self, rounded_lat: float, rounded_lon: float, place_name: str | None, recommendations: list[dict[str, Any]]) -> None:
        db = SessionLocal()
        try:
            db.add(
                CachedAiRecommendations(
                    latitude=rounded_lat,
                    longitude=rounded_lon,
                    place_name=place_name,
                    recommendations_json=json.dumps(recommendations),
                    model_used=self._model(),
                    cached_at=time.time(),
                )
            )
            db.commit()
        except Exception as e:  # noqa: BLE001 - caching is best-effort, never fatal
            logger.warning("Failed to cache AI recommendations: %s", e)
            db.rollback()
        finally:
            db.close()

    async def _reverse_geocode(self, latitude: float, longitude: float) -> str | None:
        """Best-effort only - a failure here shouldn't block getting
        recommendations, just make the prompt slightly less specific
        (falls back to coordinates alone).
        """
        try:
            async with httpx.AsyncClient(timeout=10.0, headers={"User-Agent": configuration_service.user_agent()}) as client:
                response = await client.get(NOMINATIM_URL, params={"lat": latitude, "lon": longitude, "format": "jsonv2", "zoom": 14})
                response.raise_for_status()
                data = response.json()
                address = data.get("address", {})
                parts = [
                    address.get("village") or address.get("town") or address.get("city") or address.get("hamlet"),
                    address.get("county"),
                ]
                name = ", ".join(p for p in parts if p)
                return name or data.get("display_name")
        except Exception as e:  # noqa: BLE001 - best-effort, fall back to coordinates alone
            logger.warning("Reverse geocoding failed, continuing without a place name: %s", e)
            return None

    async def _call_claude(
        self, api_key: str, latitude: float, longitude: float, place_name: str | None, known_nearby: list[str]
    ) -> list[dict[str, Any]]:
        prompt = self._build_prompt(latitude, longitude, place_name, known_nearby)

        headers = {"x-api-key": api_key, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json"}
        body = {
            "model": self._model(),
            "max_tokens": MAX_TOKENS,
            "messages": [{"role": "user", "content": prompt}],
            # Real web search rather than relying on the model's static
            # training data - see the module docstring for why. Capped
            # via max_uses; see MAX_SEARCHES_PER_CALL.
            "tools": [{"type": "web_search_20250305", "name": "web_search", "max_uses": MAX_SEARCHES_PER_CALL}],
        }

        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
            try:
                response = await client.post(ANTHROPIC_API_URL, headers=headers, json=body)
                response.raise_for_status()
            except httpx.HTTPStatusError as e:
                raise AiRecommendationsUnavailableError(f"Anthropic API error: {e.response.status_code} {e.response.text[:200]}") from e
            except httpx.HTTPError as e:
                raise AiRecommendationsUnavailableError(f"Couldn't reach Anthropic API: {e}") from e

        data = response.json()
        # With web search enabled, the response can contain several text
        # blocks interleaved with tool_use/web_search_tool_result blocks
        # (e.g. brief narration before/between searches, THEN the real
        # final answer). Concatenating every text block together - what
        # this used to do - would glue that narration onto the JSON and
        # break parsing. Only the LAST text block is the model's actual
        # concluding message once every search is done.
        text_blocks = [block.get("text", "") for block in data.get("content", []) if block.get("type") == "text"]
        text = text_blocks[-1] if text_blocks else ""
        return self._parse_recommendations(text)

    @staticmethod
    def _build_prompt(latitude: float, longitude: float, place_name: str | None, known_nearby: list[str]) -> str:
        location_desc = f"{place_name} ({latitude:.4f}, {longitude:.4f})" if place_name else f"coordinates {latitude:.4f}, {longitude:.4f}"
        context = (
            f"Known nearby places (from OpenStreetMap, for grounding - not an exhaustive list): {', '.join(known_nearby)}."
            if known_nearby
            else "No nearby places are already known."
        )
        return (
            f"A campervan is currently parked near {location_desc}. {context}\n\n"
            "Use web search to find genuinely great, specific things to see or do within about 15 miles of this "
            "location - check real, current sources (local tourism sites, blogs, review sites) rather than relying "
            "only on what you already know, since that can be outdated or wrong for a specific small area. "
            "Prioritize landmarks, viewpoints, walks, and specific eateries over generic categories - the kind of "
            "recommendation a knowledgeable local friend would give, not generic tourist-board copy. Only include "
            "real, specific, named places a search actually confirms exist near here - never fall back to a "
            "plausible-sounding invention if search comes up short. If nothing solid turns up, return fewer items "
            "(even zero) rather than guessing.\n\n"
            "Do NOT state a specific driving time or distance (e.g. '10 minutes', '5 miles south') even if a "
            "source mentions one - a source's stated distance is from its own reference point, not necessarily "
            "this exact GPS position, so repeating it as fact here is still a guess. A loose, low-confidence "
            "direction is fine if genuinely useful (e.g. 'on the coast', 'further inland'), but never a precise "
            "number.\n\n"
            "Respond with ONLY a JSON array as your final message, no narration before or after it, in exactly "
            "this shape:\n"
            '[{"name": "...", "description": "one sentence, specific and useful", "category": "landmark|walk|food|view|other"}]'
        )

    @staticmethod
    def _parse_recommendations(text: str) -> list[dict[str, Any]]:
        cleaned = text.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.strip("`")
            if cleaned.startswith("json"):
                cleaned = cleaned[4:]
            cleaned = cleaned.strip()

        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError as e:
            raise AiRecommendationsUnavailableError(f"Couldn't parse the AI's response: {e}") from e

        if not isinstance(parsed, list):
            raise AiRecommendationsUnavailableError("AI response wasn't a list as expected")

        # Defensive - only keep entries that actually have a name, and
        # coerce fields to strings so a slightly-off response shape
        # doesn't crash the route with a validation error. Descriptions
        # also go through _strip_distance_claims - a deterministic
        # backstop, not just a prompt request, since a small/fast model
        # doesn't reliably honour "don't state a specific distance"
        # (confirmed in practice - see the module docstring).
        return [
            {
                "name": str(item.get("name", "")).strip(),
                "description": _strip_distance_claims(str(item.get("description", "")).strip()),
                "category": str(item.get("category", "other")).strip(),
            }
            for item in parsed
            if isinstance(item, dict) and item.get("name")
        ]


ai_recommendations_service = AiRecommendationsService()
