"""
Weather plugin.

Uses Open-Meteo (open-meteo.com) — chosen deliberately over the more
commonly-referenced OpenWeatherMap because it's genuinely free with no
API key/signup at all, and it has a purpose-built daily
`shortwave_radiation_sum` variable (total solar energy for the day, in
MJ/m², already accounting for cloud cover) — a better direct fit for
"how much solar will we get tomorrow" than deriving it from a generic
cloud-cover percentage ourselves.

Reads the current location from ConfigurationService's "location"
section (set by the frontend via the phone's browser Geolocation API,
or the IP-based fallback) — not passed at construction time, since
location can change/get (re)set at any point while this plugin runs.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx

from app.plugins.base import Plugin, PluginStatus
from app.services import configuration_service, location_service
from app.telemetry.bus import TelemetryBus
from app.telemetry.models import TelemetryDomain, TelemetryMessage, TelemetrySource

logger = logging.getLogger("vanos.plugins.weather")

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
DEFAULT_POLL_INTERVAL_SECONDS = 1800  # 30 min - weather doesn't need to be fresher than this

# WMO weather interpretation codes - https://open-meteo.com/en/docs (bottom of page)
WMO_DESCRIPTIONS: dict[int, str] = {
    0: "clear sky",
    1: "mainly clear",
    2: "partly cloudy",
    3: "overcast",
    45: "fog",
    48: "depositing rime fog",
    51: "light drizzle",
    53: "moderate drizzle",
    55: "dense drizzle",
    56: "light freezing drizzle",
    57: "dense freezing drizzle",
    61: "slight rain",
    63: "moderate rain",
    65: "heavy rain",
    66: "light freezing rain",
    67: "heavy freezing rain",
    71: "slight snow",
    73: "moderate snow",
    75: "heavy snow",
    77: "snow grains",
    80: "slight rain showers",
    81: "moderate rain showers",
    82: "violent rain showers",
    85: "slight snow showers",
    86: "heavy snow showers",
    95: "thunderstorm",
    96: "thunderstorm with slight hail",
    99: "thunderstorm with heavy hail",
}


def describe_weather_code(code: int | None) -> str:
    if code is None:
        return "unknown"
    return WMO_DESCRIPTIONS.get(code, "unknown")


class WeatherPlugin(Plugin):
    name = "weather"
    display_name = "Weather Forecast"
    version = "1.0.0"

    def __init__(self, bus: TelemetryBus) -> None:
        super().__init__(bus)
        self._poll_interval = DEFAULT_POLL_INTERVAL_SECONDS
        self._task: asyncio.Task | None = None

    def configure(self, config: dict[str, Any]) -> None:
        super().configure(config)
        self._poll_interval = config.get("poll_interval_seconds", DEFAULT_POLL_INTERVAL_SECONDS)

    async def start(self) -> None:
        self.status = PluginStatus.STARTING
        self._task = asyncio.create_task(self._run())
        self.status = PluginStatus.RUNNING

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self.status = PluginStatus.STOPPED

    async def _run(self) -> None:
        try:
            while True:
                await self._fetch_and_publish()
                await asyncio.sleep(self._poll_interval)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 - a plugin must never crash the app
            self.status = PluginStatus.ERROR
            self.record_error(str(e))

    async def _fetch_and_publish(self) -> None:
        location = configuration_service.get("location")
        if not location or "latitude" not in location:
            # Auto-detect from the Pi's own internet connection rather
            # than requiring someone to manually tap "Use My Location"
            # on a phone first - the Pi already has real internet
            # access, and this infrastructure already existed
            # (Settings -> General's manual IP-fallback button) but was
            # never triggered automatically anywhere.
            try:
                location = await location_service.refresh_ip_fallback()
                logger.info("No location was set - auto-detected one from the Pi's own connection: %s", location.get("city"))
            except Exception as e:
                self.record_error(f"No location set, and automatic IP-based detection failed: {e}")
                return

        params = {
            "latitude": location["latitude"],
            "longitude": location["longitude"],
            "current": "temperature_2m,cloud_cover,weather_code",
            "daily": (
                "temperature_2m_max,temperature_2m_min,precipitation_sum,"
                "precipitation_probability_max,shortwave_radiation_sum,weather_code,sunrise,sunset"
            ),
            # 5 days: enough for a proper forecast row without making
            # the response heavy. today/tomorrow are still exposed
            # separately below (PowerBudgetService and the solar
            # outlook both depend on them by name), the extra days are
            # additive.
            "forecast_days": 5,
            "timezone": "auto",
        }

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.get(OPEN_METEO_URL, params=params)
                response.raise_for_status()
                data = response.json()
        except Exception as e:
            self.record_error(f"Failed to fetch weather: {e}")
            return

        current = data.get("current", {})
        daily = data.get("daily", {})

        def daily_value(key: str, index: int):
            values = daily.get(key, [])
            return values[index] if len(values) > index else None

        today_radiation = daily_value("shortwave_radiation_sum", 0)
        tomorrow_radiation = daily_value("shortwave_radiation_sum", 1)
        # How tomorrow's solar energy compares to today's - the actual
        # basis for "will tomorrow recharge as well as today did".
        radiation_ratio = (
            (tomorrow_radiation / today_radiation) if today_radiation and tomorrow_radiation and today_radiation > 0 else None
        )

        def build_day(index: int) -> dict:
            return {
                "date": daily_value("time", index),
                "weather_code": daily_value("weather_code", index),
                "weather_description": describe_weather_code(daily_value("weather_code", index)),
                "temp_max_c": daily_value("temperature_2m_max", index),
                "temp_min_c": daily_value("temperature_2m_min", index),
                "shortwave_radiation_sum_mj": daily_value("shortwave_radiation_sum", index),
                "precipitation_probability_max_pct": daily_value("precipitation_probability_max", index),
                "sunrise": daily_value("sunrise", index),
                "sunset": daily_value("sunset", index),
            }

        payload = {
            "current_temp_c": current.get("temperature_2m"),
            "current_cloud_cover_pct": current.get("cloud_cover"),
            # We already requested this from Open-Meteo's "current"
            # params but never used it - the hero display was using
            # today's DAILY AGGREGATE code instead (the day's overall
            # dominant condition, not literally right now), which is
            # exactly why "Overcast" could show up next to "0% cloud
            # cover": two genuinely different data points shown as if
            # they were the same one.
            "current_weather_code": current.get("weather_code"),
            "current_weather_description": describe_weather_code(current.get("weather_code")),
            # today/tomorrow kept as named keys deliberately, not
            # replaced by forecast[0]/forecast[1]: PowerBudgetService
            # and the intelligence providers both read them by name,
            # and breaking that to save a little duplication would be a
            # poor trade.
            "today": build_day(0),
            "tomorrow": build_day(1),
            # Full multi-day forecast for the day-tile row.
            "forecast": [build_day(i) for i in range(len(daily.get("weather_code", [])))],
            "tomorrow_vs_today_radiation_ratio": radiation_ratio,
        }

        await self.bus.publish(
            TelemetryMessage(domain=TelemetryDomain.WEATHER, source=TelemetrySource.WEATHER, timestamp=time.time(), payload=payload)
        )
        self.heartbeat()
        self.last_error = None
