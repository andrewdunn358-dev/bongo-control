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
The frontend labels this content as AI-generated and suggests
verifying before relying on it, the same "don't overstate precision"
principle used for the voltage-only battery estimate elsewhere in
this app. Grounding the prompt with real, already-known OSM places
(known_nearby below) and a real reverse-geocoded place name both
reduce - but don't eliminate - this risk.
"""

from __future__ import annotations

import json
import logging
import os
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
MAX_TOKENS = 700
REQUEST_TIMEOUT_SECONDS = 20.0

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

    async def get_recommendations(self, latitude: float, longitude: float, known_nearby: list[str]) -> dict[str, Any]:
        api_key = self._api_key()
        if not api_key:
            raise AiRecommendationsUnavailableError(
                "No Anthropic API key set - add one in Settings → Integrations (or via ANTHROPIC_API_KEY)"
            )

        rounded_lat = round(latitude, CACHE_COORD_PRECISION)
        rounded_lon = round(longitude, CACHE_COORD_PRECISION)

        cached = self._from_cache(rounded_lat, rounded_lon)
        if cached is not None:
            return cached

        place_name = await self._reverse_geocode(latitude, longitude)
        recommendations = await self._call_claude(api_key, latitude, longitude, place_name, known_nearby)
        self._store(rounded_lat, rounded_lon, place_name, recommendations)
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
        body = {"model": self._model(), "max_tokens": MAX_TOKENS, "messages": [{"role": "user", "content": prompt}]}

        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
            try:
                response = await client.post(ANTHROPIC_API_URL, headers=headers, json=body)
                response.raise_for_status()
            except httpx.HTTPStatusError as e:
                raise AiRecommendationsUnavailableError(f"Anthropic API error: {e.response.status_code} {e.response.text[:200]}") from e
            except httpx.HTTPError as e:
                raise AiRecommendationsUnavailableError(f"Couldn't reach Anthropic API: {e}") from e

        data = response.json()
        text = "".join(block.get("text", "") for block in data.get("content", []) if block.get("type") == "text")
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
            "Suggest up to 5 genuinely interesting things to see or do within a short drive or walk - the kind of "
            "specific, real local recommendations a knowledgeable local friend would give, not generic tourist-board "
            "advice. Prioritize landmarks, viewpoints, walks, and specific eateries over generic categories. Only "
            "suggest real, specific, named places you have actual knowledge of - never invent a plausible-sounding "
            "one. If you don't have enough confident knowledge of this specific area, return fewer items (even "
            "zero) rather than guessing.\n\n"
            "Respond with ONLY a JSON array, no other text, in exactly this shape:\n"
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
        # doesn't crash the route with a validation error.
        return [
            {
                "name": str(item.get("name", "")).strip(),
                "description": str(item.get("description", "")).strip(),
                "category": str(item.get("category", "other")).strip(),
            }
            for item in parsed
            if isinstance(item, dict) and item.get("name")
        ]


ai_recommendations_service = AiRecommendationsService()
