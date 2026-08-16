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
from app.services.relay_service import relay_service
from app.services.roof_service import roof_service
from app.telemetry.bus import bus
from app.telemetry.models import TelemetryDomain

# Imported lazily where used (see _describe_mission_brief) to avoid a
# hard import-time dependency on the intelligence module for a service
# that otherwise has none - this is the same get_engine() accessor
# pattern intelligence.py's own route already uses.

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
PERSONA_NAME = "Ron"


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
        lines.append(self._describe_mission_brief())
        lines.append("")
        lines.append(self._describe_capabilities())
        lines.append(
            "If asked something this context doesn't cover and you're not confident, say so plainly rather "
            "than guessing - the same honesty this whole app is built around (e.g. it never shows a fake "
            "battery percentage without a shunt installed)."
        )
        return "\n".join(lines)

    @staticmethod
    def _describe_capabilities() -> str:
        """Reported real gap: Ron confidently told someone he had 'no
        hands on the radio dial' and 'nobody's wired me up to your
        media player' - both false. The system prompt used to only
        ever describe TELEMETRY (weather, battery, location) and never
        actual capabilities at all, so that answer wasn't a
        hallucination so much as an honest, reasonable conclusion from
        genuinely incomplete information - nothing in the prompt said
        otherwise. This section exists so that's no longer true.

        Deliberately doesn't claim Ron EXECUTES these - both are
        handled by a separate pattern-matching layer in
        voice_control_service.py BEFORE a request ever reaches this
        chat at all (relay commands and 'play <station>' are matched
        and acted on directly; only what doesn't match falls through
        to here). So the honest instruction is "tell them the exact
        phrase", not "do it yourself" - conversational rephrasing
        ("play something else", "skip to another station") genuinely
        can't be acted on by either layer, and Ron should say so rather
        than pretend to try.

        Relay names built from the live config, same as
        voice_control_service's own _voice_controllable_relays() -
        stays accurate if they're ever renamed, and the roof relays are
        structurally excluded here the same deliberate way they are
        there (hold-to-run only, never a plain voice on/off).
        """
        try:
            channels = relay_service.status().get("channels", [])
            roof_ids = roof_service.managed_channel_ids
            relay_names = sorted({str(c["name"]).strip() for c in channels if c.get("id") not in roof_ids and c.get("name")})
        except Exception:  # noqa: BLE001 - this is prompt context, not a critical path; missing it shouldn't break a reply
            relay_names = []

        lines = ["Things this app can actually DO by voice (not just report on) - you don't execute these yourself, a separate layer does, before your own reply even runs. If asked to control one of these, tell the person the exact phrase to say:"]
        if relay_names:
            lines.append(f"- Saying 'turn the {', '.join(relay_names)} on' or 'off' toggles that physical circuit.")
        lines.append(
            "- Saying 'play <station name>' searches UK internet radio and starts that station playing through "
            "the van's speaker; 'play the radio' alone starts whatever's set as the default station."
        )
        # Reported live: asked to "turn off the radio", Ron said there was
        # no stop command in his playbook at all and suggested killing the
        # Amp circuit instead. The command did exist - it just wasn't
        # listed here, so he had no way to know. The only radio this app
        # can play is its own internet stream, so "the radio" from a user
        # means that stream unless a relay is literally named radio (which
        # the list above would then show).
        radio_stop_phrases = "'stop the radio', 'pause the radio'"
        if "radio" not in {n.lower() for n in relay_names}:
            radio_stop_phrases += " or 'turn the radio off'"
        lines.append(
            f"- Saying {radio_stop_phrases} stops that stream. The only radio this app can play is that "
            "internet stream - so if someone asks to stop or turn off 'the radio', they mean it, and the "
            "command exists. Do not tell them to switch off a relay circuit instead."
        )
        lines.append(
            "Anything phrased differently from those exact patterns - 'play something else', 'skip to another "
            "station', 'turn the roof up' - genuinely can't be acted on by either you or that layer. Say so "
            "honestly and suggest the phrasing that would actually work, rather than claiming no such feature "
            "exists at all."
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

    @staticmethod
    def _describe_mission_brief() -> str:
        """The Intelligence Engine's own aggregated view (Green/Amber/
        Red status, its recommendations, its numeric predictions) - the
        SAME computation the Overview page's Mission Brief renders, not
        a second, separately-derived summary. Deliberately reuses
        get_engine() (see intelligence.py) rather than recomputing
        anything here - one signal-aggregation implementation, not two
        that could quietly disagree with each other.

        Previously the persona had no access to this at all - asked
        "how's the van doing overall" or "should I run the heater
        tonight" it could only reason from the same raw battery/weather
        numbers already given to it separately above, not the engine's
        own already-computed verdict and predictions (estimated
        runtime, heater-all-night-possible, etc.) - duplicating
        reasoning the engine had already done, and risking a different
        answer than what the Overview page itself would show for the
        same question.
        """
        from app.api.routes.intelligence import get_engine

        engine = get_engine()
        brief = engine.latest() if engine else None
        if brief is None:
            return "- Overall van status (Mission Brief): not computed yet."

        bits = [f"status {brief.status.value.upper()} ({brief.summary})"]
        if brief.recommendations:
            bits.append("recommendations: " + "; ".join(brief.recommendations))
        for pred in brief.predictions:
            if pred.value is None:
                continue
            value_str = f"{pred.value}{pred.unit or ''}"
            if pred.confidence:
                value_str += f" ({pred.confidence})"
            bits.append(f"{pred.label}: {value_str}")
        return f"- Overall van status (Mission Brief - this IS the app's own computed verdict, not a guess): {'; '.join(bits)}."


ai_chat_service = AiChatService()
