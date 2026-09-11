"""
Diesel heater fuel consumption.

Integrates the heater's estimated burn rate over HEATING history to give
litres per day, plus a running total since the tank was last filled.

WHY THIS MATTERS ON THIS VAN SPECIFICALLY
The heater is plumbed into the VEHICLE fuel tank, not a separate one. So
what it burns overnight comes straight off driving range - and a night's
heating you haven't accounted for is fuel you thought you had. On a
separate-tank install this would be a curiosity; here it is range.

ESTIMATED, NOT MEASURED - AND IT SAYS SO
The heater does not report fuel use. The rate comes from a gear-to-
litres-per-hour table (see heater_agent.fuel_rate_lph), which is
reasonable because these pumps are fixed-displacement and the gear sets
the pump frequency directly. It is still a model. Every figure this
produces carries `estimated: True` so nothing downstream can present it
as a reading.

The honest weak point: in temperature mode the heater picks its own gear
and does not report which, so the rate is assumed mid-table. A long run
in temperature mode is therefore the least accurate case - which is also
the most common one. Treat the daily figure as an indication, not a
fuel gauge.
"""

from __future__ import annotations

import logging
import time

from app.intelligence.daily_cache import DailyAggregateCache, day_key
from app.telemetry.models import TelemetryDomain

logger = logging.getLogger("vanos.heater_fuel")

# Ignore gaps longer than this when integrating. The heater history is
# sampled every 60s; a bigger gap means the backend was down or the
# heater unreachable, and treating it as steady burning across the gap
# would invent fuel that was never used. Same reasoning as the solar
# integration's DT_CAP_SECONDS.
DT_CAP_SECONDS = 300

LOOKBACK_DAYS = 30


def day_litres(rows: list[dict]) -> float:
    """Litres burned across one day's heating rows.

    Trapezoid integration of `fuel_lph`, the same shape as the solar
    watt-hour integration. A row with no rate (off, or ventilating) ends
    the current interval rather than contributing zero - the heater
    either burns or it does not, and averaging across an off period
    would smear fuel into hours it was not running.
    """
    total = 0.0
    prev: tuple[float, float] | None = None

    for row in sorted(rows, key=lambda r: r["timestamp"]):
        rate = row.get("payload", {}).get("fuel_lph")
        ts = row["timestamp"]

        if rate is None:
            prev = None
            continue

        if prev is not None:
            dt = min(ts - prev[0], DT_CAP_SECONDS)
            if dt > 0:
                total += (rate + prev[1]) / 2 * dt / 3600.0

        prev = (ts, rate)

    return round(total, 3)


class HeaterFuelService:
    def __init__(self, history_service, configuration_service, cache: DailyAggregateCache | None = None) -> None:
        self._history = history_service
        self._config = configuration_service
        # Shares the intelligence engine's cache when given one, so
        # completed days are integrated once rather than on every read.
        self._cache = cache or DailyAggregateCache(history_service)

    def summary(self) -> dict:
        """Everything the Heater page needs to show fuel."""
        series = self._cache.series(
            "heater_fuel_litres", TelemetryDomain.HEATING.value, LOOKBACK_DAYS, day_litres
        )

        today = day_key(time.time())
        today_litres = float(series.get(today) or 0.0)

        section = self._config.get("heater_fuel", {}) or {}
        filled_at = section.get("tank_filled_at")
        tank_litres = section.get("tank_litres")

        since_fill = None
        if filled_at:
            since_fill = round(
                sum(
                    float(v or 0.0)
                    for day, v in series.items()
                    if day >= day_key(float(filled_at))
                ),
                2,
            )

        # Nights per tank, from what this van actually uses rather than a
        # brochure figure. Needs a few days of real data - below that the
        # average is noise and it is better to say nothing.
        complete = [float(v) for day, v in series.items() if day != today and v]
        typical_day = round(sum(complete) / len(complete), 2) if len(complete) >= 3 else None

        remaining = None
        if tank_litres and since_fill is not None:
            remaining = round(max(0.0, float(tank_litres) - since_fill), 1)

        return {
            # Everything here is modelled. See the module docstring.
            "estimated": True,
            "today_litres": round(today_litres, 2),
            "since_fill_litres": since_fill,
            "tank_filled_at": filled_at,
            "tank_litres": tank_litres,
            "tank_remaining_litres": remaining,
            "typical_day_litres": typical_day,
            "daily": {day: round(float(v or 0.0), 2) for day, v in sorted(series.items())},
        }

    def mark_filled(self) -> dict:
        """Reset the since-fill total. Called when the tank is filled.

        Stores a timestamp rather than zeroing a counter, so the figure
        stays derivable from history: if the backend restarts, or a day
        is recomputed, the answer does not drift.
        """
        section = dict(self._config.get("heater_fuel", {}) or {})
        section["tank_filled_at"] = time.time()
        self._config.set("heater_fuel", section)
        logger.info("Heater fuel: tank marked as filled")
        return self.summary()
