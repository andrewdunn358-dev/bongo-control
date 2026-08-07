"""
AiChatService — a real back-and-forth chat, unlike ai_recommendations_
service's one-shot "what's cool nearby" (see that module's docstring
for why one-shot was the right call there). This is deliberately
different: general vanlife/travel/camping Q&A benefits from follow-up
questions ("what about if it rains?", "does that work off-grid?") in a
way a single fixed-shape response doesn't.

What makes this worth having over a generic chatbot: every call is
grounded in the van's OWN current, real data - location, weather,
battery/solar state, connectivity - built fresh into the system prompt
each turn. Same honesty rules as everywhere else in this app: if a
reading isn't available (no shunt, no GPS fix yet), the prompt says so
explicitly rather than omitting it, so the model can't quietly assume
data that doesn't exist.

Deliberately NOT persisted server-side. The frontend holds the message
list in memory and resends the full history each call - avoids a new
DB table and the "how long do we keep someone's chat log" question for
what several messages are used for. History is empty on a page reload.
Same "ask only when the person acts, never automatically" cost
discipline as the recommendations feature - there is no background
polling here at all.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Literal

import httpx
from pydantic import BaseModel

from app.services.configuration_service import configuration_service
from app.services import location_service
from app.telemetry.bus import bus
from app.telemetry.models import TelemetryDomain

logger = logging.getLogger("vanos.ai_chat_service")

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
DEFAULT_MODEL = "claude-haiku-4-5-20251001"
MAX_TOKENS = 1024
REQUEST_TIMEOUT_SECONDS = 60.0
MAX_SEARCHES_PER_CALL = 3
# Bounds the conversation sent back to the API each turn - a long
# back-and-forth otherwise costs more with every message (the whole
# history is resent every time, there's no server-side session). 20
# messages (~10 exchanges) is generous for this kind of Q&A without
# letting cost creep silently.
MAX_HISTORY_MESSAGES = 20


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AiChatUnavailableError(RuntimeError):
    pass


# The assistant's persona, used both in the system prompt and echoed
# to the frontend (GET /api/ai/persona) so the name/avatar shown on the
# page and the personality actually talking are never out of sync.
PERSONA_NAME = "Maggie"


class AiChatService:
    @staticmethod
    def _api_key() -> str:
        cfg = configuration_service.get("general", {}) or {}
        return str(cfg.get("anthropic_api_key") or "").strip() or os.environ.get("ANTHROPIC_API_KEY", "")

    @staticmethod
    def _model() -> str:
        cfg = configuration_service.get("general", {}) or {}
        return str(cfg.get("ai_model") or "").strip() or os.environ.get("AI_RECOMMENDATIONS_MODEL") or DEFAULT_MODEL

    def is_configured(self) -> bool:
        return bool(self._api_key())

    async def reply(self, history: list[ChatMessage]) -> str:
        api_key = self._api_key()
        if not api_key:
            raise AiChatUnavailableError(
                "No Anthropic API key set - add one in Settings → Integrations (or via ANTHROPIC_API_KEY)"
            )
        if not history or history[-1].role != "user":
            raise AiChatUnavailableError("No user message to reply to")

        trimmed = history[-MAX_HISTORY_MESSAGES:]
        system_prompt = await self._build_system_prompt()

        headers = {"x-api-key": api_key, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json"}
        body = {
            "model": self._model(),
            "max_tokens": MAX_TOKENS,
            "system": system_prompt,
            "messages": [{"role": m.role, "content": m.content} for m in trimmed],
            # Web search available but not forced - most van/camping Q&A
            # is answerable from the grounding context below or general
            # knowledge; search is there for "what's the weather doing
            # in Scotland this weekend" type questions that need
            # current info beyond this one van's own sensors.
            "tools": [{"type": "web_search_20250305", "name": "web_search", "max_uses": MAX_SEARCHES_PER_CALL}],
        }

        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
            try:
                response = await client.post(ANTHROPIC_API_URL, headers=headers, json=body)
                response.raise_for_status()
            except httpx.HTTPStatusError as e:
                raise AiChatUnavailableError(f"Anthropic API error: {e.response.status_code} {e.response.text[:200]}") from e
            except httpx.HTTPError as e:
                raise AiChatUnavailableError(f"Couldn't reach Anthropic API: {e}") from e

        data = response.json()
        # Same reasoning as ai_recommendations_service: with web search
        # on, several text blocks can appear interleaved with tool-use
        # blocks (brief narration before/between searches). The last
        # text block is the actual concluding answer.
        text_blocks = [block.get("text", "") for block in data.get("content", []) if block.get("type") == "text"]
        reply = text_blocks[-1] if text_blocks else ""
        if not reply.strip():
            raise AiChatUnavailableError("The AI didn't return a text reply")
        return reply.strip()

    async def _build_system_prompt(self) -> str:
        """Fresh every call, not cached - the whole point is that this
        reflects right-now, not whatever it was when the chat opened."""
        lines = [
            f"You are {PERSONA_NAME}, the assistant built into VanOS, a campervan control system running on "
            "a Mazda Bongo Friendee. You're a vanlife veteran in your 40s who's spent years on the road - "
            "warm, funny, a bit cheeky, genuinely good company. You give honest, practical advice like a "
            "well-travelled friend would, not generic tourist-brochure copy. Let your personality come "
            "through in how you talk (playful banter is welcome), but don't let it get in the way of actually "
            "being useful - the person asking has a real question underneath the small talk. Be concise - "
            "this is a small screen in a van, not a desktop chat window. A few sentences unless genuinely "
            "asked for more detail. You're a character with warmth and charm, not a romantic or flirtatious "
            "presence - keep any charm platonic and about being great company, never suggestive.",
            "",
            "Current van context (use this, don't guess a different value for anything listed here):",
        ]
        lines.append(self._describe_location())
        lines.append(self._describe_weather())
        lines.append(self._describe_environment())
        lines.append(self._describe_battery_and_solar())
        lines.append(self._describe_connectivity())
        lines.append(
            "If asked something this context doesn't cover and you're not confident, say so plainly rather "
            "than guessing - the same honesty this whole app is built around (e.g. it never shows a fake "
            "battery percentage without a shunt installed)."
        )
        return "\n".join(lines)

    @staticmethod
    def _describe_location() -> str:
        location = location_service.get()
        if not location:
            return "- Location: not set."
        lat, lon = location.get("latitude"), location.get("longitude")
        source = location.get("source", "unknown")
        return f"- Location: {lat:.4f}, {lon:.4f} (source: {source})."

    @staticmethod
    def _describe_weather() -> str:
        msg = bus.latest(TelemetryDomain.WEATHER)
        if msg is None or not msg.payload:
            return "- Weather: no reading yet."
        p = msg.payload
        bits = []
        if p.get("current_temp_c") is not None:
            bits.append(f"{p['current_temp_c']}°C now")
        if p.get("current_weather_description"):
            bits.append(str(p["current_weather_description"]))
        tomorrow = p.get("tomorrow") or {}
        if tomorrow.get("precipitation_probability_max_pct") is not None:
            bits.append(f"{tomorrow['precipitation_probability_max_pct']}% chance of rain tomorrow")
        return f"- Weather: {', '.join(bits) if bits else 'reading present but no usable fields'}."

    @staticmethod
    def _describe_battery_and_solar() -> str:
        battery = bus.latest(TelemetryDomain.BATTERY)
        solar = bus.latest(TelemetryDomain.SOLAR)
        bits = []
        if battery and battery.payload:
            bp = battery.payload
            if bp.get("voltage") is not None:
                bits.append(f"{bp['voltage']}V" + (", charging" if bp.get("charging") else ", not charging"))
            # Deliberately do NOT invent a percentage here if soc_pct is
            # null - an LLM asked "how much battery do I have" with no
            # number in its context WILL make one up unless the prompt
            # says explicitly not to. This is that guard.
            if bp.get("soc_pct") is not None:
                bits.append(f"{bp['soc_pct']}% state of charge")
            else:
                bits.append("no state-of-charge percentage available (no battery shunt installed - voltage only)")
        if solar and solar.payload and solar.payload.get("watts") is not None:
            bits.append(f"{solar.payload['watts']}W solar right now")
        if not bits:
            return "- Battery/solar: no reading yet."
        return f"- Battery/solar: {', '.join(bits)}. Never state a specific Ah or % figure beyond what's given here."

    @staticmethod
    def _describe_environment() -> str:
        msg = bus.latest(TelemetryDomain.ENVIRONMENT)
        if msg is None or not msg.payload:
            return "- Van temperature: no reading yet."
        p = msg.payload
        bits = []
        if p.get("internal_temp_c") is not None:
            bits.append(f"{p['internal_temp_c']}°C inside")
        if p.get("external_temp_c") is not None:
            bits.append(f"{p['external_temp_c']}°C outside")
        return f"- Van temperature: {', '.join(bits) if bits else 'reading present but no usable fields'}."

    @staticmethod
    def _describe_connectivity() -> str:
        msg = bus.latest(TelemetryDomain.CONNECTIVITY)
        if msg is None or not msg.payload:
            return "- Connectivity: no reading yet."
        p = msg.payload
        return f"- Connectivity: {'online' if p.get('online') else 'offline'}."


ai_chat_service = AiChatService()
