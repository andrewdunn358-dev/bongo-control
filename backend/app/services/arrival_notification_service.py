"""
ArrivalNotificationService — proactively notices when the van has
genuinely arrived and settled somewhere NEW (not just moving around,
not the same spot re-confirmed), and surfaces a real AI-generated
"what's interesting nearby" suggestion as a notification, without
anyone having to ask.

Builds directly on two already-existing, deliberately manual features:
ai_recommendations_service (the actual recommendation generation, and
crucially its own week-long per-location cache) and
notification_service (the existing single-WebSocket notification
channel already used for plugin connect/disconnect events). This
service's own job is narrow and specific: decide WHEN it's worth
firing that existing machinery automatically. It doesn't duplicate any
of the actual recommendation logic, the POI grounding, or the web
search - all of that is exactly what a manual tap of the existing
button already does, just triggered here by GPS behaviour instead of
a finger.

COST SAFETY: this is the one thing that needed real care before adding
ANY automatic trigger to a feature whose own module docstring says
"never automatically or on a schedule... every call costs real money."
Two independent safeguards, not just one:
1. ai_recommendations_service's OWN week-long cache per rounded
   location already protects the actual API cost - a repeat visit to
   anywhere already checked (by this service OR the manual button)
   within a week is a free cache hit, not a new charge, with zero
   changes needed here to get that protection.
2. This service separately tracks (persisted in config, survives a
   restart) the last location it already sent a NOTIFICATION for, so
   it doesn't pester with a repeat notification about a stay it
   already announced, even on a cache hit.

STAY DETECTION: polls location_service on a plain timer rather than
reacting to every GPS update, unlike IntelligenceRunner's
BATTERY/WEATHER-subscribed approach - there's no LOCATION domain on
the telemetry bus to subscribe to (see TelemetryDomain - it's
deliberately not one of the categories), and "has this been the same
rough spot for a genuinely meaningful while" doesn't need finer
granularity than a periodic check anyway, unlike reacting to a battery
reading changing.
"""

from __future__ import annotations

import asyncio
import logging
import time

from app.services.configuration_service import configuration_service
from app.services import location_service, poi_service
from app.services.ai_recommendations_service import AiRecommendationsUnavailableError, ai_recommendations_service
from app.services.location_service import _haversine_metres
from app.services.notification_service import NotificationLevel, notification_service
from app.services.voice_control_service import voice_control_service

logger = logging.getLogger("vanos.arrival_notification_service")

CHECK_INTERVAL_SECONDS = 300  # every 5 minutes - "have we settled somewhere" doesn't need finer granularity than that
STAY_RADIUS_METRES = 300  # how far the van can drift and still count as "the same spot" (parking, repositioning)
STAY_THRESHOLD_SECONDS = 20 * 60  # how long genuinely stationary before this counts as "arrived", not just a stop
# How far from the LAST notified spot counts as genuinely "somewhere
# new" again. Deliberate, honest scope limit: this only remembers the
# single MOST RECENT notified location, not a full history of
# everywhere ever announced - covers the realistic common case
# (leaving a spot briefly and coming straight back to it) without
# needing a proper growing table + pruning strategy for something this
# secondary. The real edge this doesn't cover: visit A, then B (a
# second, separate announcement, correctly), then return to A - a
# third announcement WOULD fire, since only B is remembered as "last".
# Worth upgrading to real per-location history later if that pattern
# turns out to be genuinely common in practice; not worth the added
# complexity speculatively.
RENOTIFY_DISTANCE_METRES = 1000


class ArrivalNotificationService:
    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        # The current candidate "stay" - reset whenever the van moves
        # outside STAY_RADIUS_METRES of it. None until the first check
        # after startup establishes one - deliberately does NOT
        # announce anything on the very first check after a restart,
        # even if the van's already been sat somewhere a while, since
        # there's no way to know how long that's actually been without
        # this service having been watching the whole time.
        self._stay_center: tuple[float, float] | None = None
        self._stay_started_at: float | None = None
        self._notified_this_stay = False

    async def start(self) -> None:
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _run(self) -> None:
        try:
            while True:
                await asyncio.sleep(CHECK_INTERVAL_SECONDS)
                try:
                    await self._check_once()
                except Exception as e:  # noqa: BLE001 - a single bad check must never kill the whole loop
                    logger.warning("Arrival notification check failed, will retry next interval: %s", e)
        except asyncio.CancelledError:
            raise

    @staticmethod
    def _last_notified_location() -> tuple[float, float] | None:
        raw = (configuration_service.get("general", {}) or {}).get("last_arrival_notification_location")
        if not isinstance(raw, dict) or "latitude" not in raw or "longitude" not in raw:
            return None
        return (raw["latitude"], raw["longitude"])

    @staticmethod
    def _save_last_notified_location(latitude: float, longitude: float) -> None:
        general = configuration_service.get("general", {}) or {}
        configuration_service.set(
            "general",
            {**general, "last_arrival_notification_location": {"latitude": latitude, "longitude": longitude}},
        )

    async def _check_once(self) -> None:
        location = location_service.get()
        if location is None:
            return
        lat, lon = location["latitude"], location["longitude"]

        if self._stay_center is None:
            self._start_new_candidate_stay(lat, lon)
            return

        moved = _haversine_metres(self._stay_center[0], self._stay_center[1], lat, lon)
        if moved > STAY_RADIUS_METRES:
            # Genuinely moved on - this is a new candidate stay
            # starting fresh, not the same one continuing.
            self._start_new_candidate_stay(lat, lon)
            return

        if self._notified_this_stay:
            return  # already announced this exact stay - don't repeat

        assert self._stay_started_at is not None
        if time.time() - self._stay_started_at < STAY_THRESHOLD_SECONDS:
            return  # not genuinely settled here yet - could still just be a longer stop

        last_notified = self._last_notified_location()
        if last_notified is not None:
            distance_from_last = _haversine_metres(last_notified[0], last_notified[1], lat, lon)
            if distance_from_last < RENOTIFY_DISTANCE_METRES:
                # Close to somewhere already announced recently (e.g.
                # left and came back to roughly the same spot) - don't
                # repeat the same notification for what's functionally
                # the same place, even though it registers as a "new"
                # stay by the radius check above.
                self._notified_this_stay = True
                return

        await self._announce(lat, lon)

    async def trigger_check_now(self, bypass_renotify_check: bool = False) -> dict:
        """Manual test entrypoint - runs the real _announce() pipeline
        immediately at the CURRENT location, bypassing the normal
        20-minute stay-duration wait (the whole point of a manual test
        is not waiting the real time out) but still going through the
        exact same POI search + AI recommendation call + notification
        send as the real automatic path - a genuine test of the real
        pipeline, not a separate one that could pass while the real
        path is actually broken.

        Still respects the re-notification cost-safety check by
        default (won't re-announce somewhere already covered recently)
        UNLESS bypass_renotify_check is explicitly set - lets a second
        manual test actually exercise the announce path again rather
        than silently no-op'ing every time after the first call.
        """
        location = location_service.get()
        if location is None:
            return {"announced": False, "reason": "no_location"}
        lat, lon = location["latitude"], location["longitude"]

        if not bypass_renotify_check:
            last_notified = self._last_notified_location()
            if last_notified is not None:
                distance = _haversine_metres(last_notified[0], last_notified[1], lat, lon)
                if distance < RENOTIFY_DISTANCE_METRES:
                    return {"announced": False, "reason": "already_notified_nearby", "distance_metres": round(distance)}

        return await self._announce(lat, lon)

    def _start_new_candidate_stay(self, lat: float, lon: float) -> None:
        self._stay_center = (lat, lon)
        self._stay_started_at = time.time()
        self._notified_this_stay = False

    async def _announce(self, latitude: float, longitude: float) -> dict:
        if not ai_recommendations_service.is_configured():
            return {"announced": False, "reason": "no_anthropic_key"}

        known_nearby: list[str] = []
        try:
            poi_result = await poi_service.search_nearby(latitude, longitude, radius_m=15000, categories=[])
            known_nearby = [p["name"] for p in poi_result["results"] if p.get("name")][:15]
        except Exception:  # noqa: BLE001 - POI lookup failing shouldn't block this, just proceed with less grounding
            pass

        try:
            result = await ai_recommendations_service.get_recommendations(latitude, longitude, known_nearby)
        except AiRecommendationsUnavailableError as e:
            logger.info("Arrival notification: recommendations unavailable, skipping this stay: %s", e)
            return {"announced": False, "reason": "recommendations_unavailable", "detail": str(e)}

        recommendations = result.get("recommendations") or []
        if not recommendations:
            # A genuinely empty result (the underlying service returns
            # fewer/zero items rather than inventing a plausible-
            # sounding one when search comes up short - see its own
            # module docstring) means there's honestly nothing worth
            # announcing here, not a failure to work around.
            return {"announced": False, "reason": "no_recommendations_found", "place_name": result.get("place_name")}

        place_name = result.get("place_name") or "your new spot"
        top = recommendations[0]
        title = f"Looks like you've settled in near {place_name}"
        message = top.get("description") or top.get("name") or "Check the Nearby page for what's around."
        if top.get("name") and top.get("description"):
            message = f"{top['name']} - {top['description']}"

        self._notified_this_stay = True
        self._save_last_notified_location(latitude, longitude)
        await notification_service.notify(NotificationLevel.INFO, title, message)
        await self._speak(title, message)
        logger.info("Arrival notification sent for %s (%.4f, %.4f)", place_name, latitude, longitude)
        return {"announced": True, "place_name": place_name, "title": title, "message": message}

    @staticmethod
    async def _speak(title: str, message: str) -> None:
        """Reported gap: this only ever sent a silent visual
        notification - reused here is the exact same TTS pipeline
        every other spoken reply in this app already goes through
        (voice_control_service's own _synthesize()/_play_clip()), not
        a separate one. That also means this gets the SAME markdown
        stripping (_clean_text_for_speech()) everything else does,
        and the SAME radio-ducking _play_clip() already handles
        internally - nothing extra needed here for either.

        Best-effort, deliberately: if speaking fails for any reason
        (no Google TTS key configured, a quota limit, anything) the
        notification itself has already gone out above - this
        shouldn't retroactively make the whole announcement a failure
        over the speaking half specifically.
        """
        try:
            spoken_text = voice_control_service._clean_text_for_speech(f"{title}. {message}")
            audio = await asyncio.to_thread(voice_control_service._synthesize, spoken_text)
            await asyncio.to_thread(voice_control_service._play_clip, audio)
        except Exception as e:  # noqa: BLE001 - speaking is a bonus on top of the real notification, not something that should undo it
            logger.warning("Arrival notification: speaking it aloud failed (notification was still sent): %s", e)


arrival_notification_service = ArrivalNotificationService()
