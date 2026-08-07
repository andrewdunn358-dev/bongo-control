"""
PowerBudgetService — computes the "Power Budget" (SYSTEM domain), now
for real: hardware-agnostic (works identically whether Simulation or a
real plugin like Victron is providing the underlying battery/solar
data), using actual recorded history rather than fabricated math.

Previously this was published directly by SimulationEngine using
made-up constants — meaningless once real hardware is involved (Victron
alone doesn't publish it at all). This service is the single owner of
the SYSTEM domain going forward, subscribing to the bus like
BatteryService does, so it works the same regardless of what's
actually producing the underlying telemetry.

Tomorrow's outlook specifically: rather than asking the user to
configure abstract panel wattage/specs, it calibrates against *actual
recorded performance* — comparing Open-Meteo's forecasted solar energy
for tomorrow vs. today against today's *actual* recorded yield (real
MPPT data, or simulation) gives a defensible relative estimate without
needing to model the panel itself.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from app.services.history_service import HistoryService
from app.services.telemetry_service import TelemetryService
from app.telemetry.models import TelemetryDomain, TelemetryMessage, TelemetrySource

logger = logging.getLogger("vanos.power_budget_service")

RECOMPUTE_MIN_INTERVAL_SECONDS = 30
DEFAULT_TYPICAL_LOAD_WATTS = 50.0  # used only when no real load history exists to estimate from
NOMINAL_BANK_WH = 100 * 12.8  # 100Ah @ 12.8V - same assumption the old simulation-only math used


class PowerBudgetService:
    def __init__(self, telemetry_service: TelemetryService, history_service: HistoryService) -> None:
        self._telemetry = telemetry_service
        self._history = history_service
        self._task: asyncio.Task | None = None
        self._last_computed_at: float = 0.0

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
        queue = self._telemetry.subscribe()
        try:
            while True:
                message = await queue.get()
                if message.domain not in (TelemetryDomain.BATTERY.value, TelemetryDomain.WEATHER.value):
                    continue
                now = time.time()
                if now - self._last_computed_at < RECOMPUTE_MIN_INTERVAL_SECONDS:
                    continue
                self._last_computed_at = now
                await self._recompute()
        except asyncio.CancelledError:
            raise
        finally:
            self._telemetry.unsubscribe(queue)

    async def _recompute(self) -> None:
        battery_msg = self._telemetry.latest(TelemetryDomain.BATTERY)
        weather_msg = self._telemetry.latest(TelemetryDomain.WEATHER)

        payload: dict[str, Any] = {"power_budget": self._compute_power_budget(battery_msg), "tomorrow_outlook": self._compute_tomorrow_outlook(weather_msg)}

        await self._telemetry.publish(
            TelemetryMessage(domain=TelemetryDomain.SYSTEM, source=TelemetrySource.SYSTEM, timestamp=time.time(), payload=payload)
        )

    def _compute_power_budget(self, battery_msg) -> dict[str, Any]:
        if battery_msg is None:
            return {
                "heater_all_night_possible": None,
                "estimated_runtime_hours": None,
                "note": "No battery data yet",
            }

        soc_pct = battery_msg.payload.get("soc_pct")
        voltage = battery_msg.payload.get("voltage")

        if soc_pct is None:
            # No shunt - fall back to a voltage-based rough read, clearly
            # caveated rather than presented as precise.
            return {
                "heater_all_night_possible": voltage is not None and voltage > 12.8,
                "estimated_runtime_hours": None,
                "note": "No battery shunt installed - estimate based on voltage only, not precise",
            }

        bank_wh_remaining = (soc_pct / 100.0) * NOMINAL_BANK_WH
        typical_load_watts = self._estimate_typical_load_watts()
        estimated_runtime_hours = round(min(999, bank_wh_remaining / typical_load_watts), 1) if typical_load_watts > 0 else None

        return {
            "heater_all_night_possible": bank_wh_remaining > 120 * 8,
            "estimated_runtime_hours": estimated_runtime_hours,
            "note": None,
        }

    def _estimate_typical_load_watts(self) -> float:
        """Derives a rough typical load from recent battery discharge rate
        if we have enough history; falls back to a fixed assumption
        otherwise. This is intentionally simple - a real load-current
        measurement (SmartShunt) will replace this estimate entirely
        once that hardware exists.
        """
        recent = self._history.query(TelemetryDomain.BATTERY.value, time.time() - 6 * 3600)
        socs = [(r["timestamp"], r["payload"].get("soc_pct")) for r in recent if r["payload"].get("soc_pct") is not None]
        if len(socs) < 2:
            return DEFAULT_TYPICAL_LOAD_WATTS

        (t0, soc0), (t1, soc1) = socs[0], socs[-1]
        elapsed_hours = (t1 - t0) / 3600
        if elapsed_hours <= 0 or soc1 >= soc0:
            return DEFAULT_TYPICAL_LOAD_WATTS  # net charging over the window, can't infer a discharge rate

        soc_drop = soc0 - soc1
        wh_used = (soc_drop / 100.0) * NOMINAL_BANK_WH
        watts = wh_used / elapsed_hours
        return watts if watts > 1 else DEFAULT_TYPICAL_LOAD_WATTS

    def _compute_tomorrow_outlook(self, weather_msg) -> dict[str, Any]:
        if weather_msg is None:
            return {
                "summary": "unknown",
                "recommendation": "Weather forecasting not configured yet - set a location and enable the Weather plugin in Settings.",
            }

        tomorrow = weather_msg.payload.get("tomorrow", {})
        ratio = weather_msg.payload.get("tomorrow_vs_today_radiation_ratio")
        description = tomorrow.get("weather_description", "unknown")

        if ratio is None:
            recommendation = f"Tomorrow looks {description} - not enough data yet to compare against today's production."
        elif ratio >= 0.85:
            recommendation = f"Tomorrow looks {description} - similar solar production to today expected."
        elif ratio >= 0.5:
            recommendation = f"Tomorrow looks {description} - somewhat less solar than today, roughly {round(ratio * 100)}% as much."
        else:
            recommendation = f"Tomorrow looks {description} - significantly less solar expected (~{round(ratio * 100)}% of today) - consider conserving power tonight."

        return {
            "summary": description,
            "radiation_ratio_vs_today": ratio,
            "precipitation_probability_pct": tomorrow.get("precipitation_probability_max_pct"),
            "recommendation": recommendation,
        }
