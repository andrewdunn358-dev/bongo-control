"""
PowerPredictionProvider — the numeric half of PowerBudgetService's
original logic (estimated runtime, heater-tonight, solar energy
figures), carried over verbatim including the typical-load-from-
discharge-rate estimation.
"""

from __future__ import annotations

import time

from app.services.history_service import HistoryService
from app.services.telemetry_service import TelemetryService
from app.telemetry.models import TelemetryDomain
from app.intelligence.signals import Prediction

DEFAULT_TYPICAL_LOAD_WATTS = 50.0  # used only when no real load history exists to estimate from
NOMINAL_BANK_WH = 100 * 12.8  # 100Ah @ 12.8V - same assumption the original math used
HEATER_ALL_NIGHT_WH_THRESHOLD = 120 * 8
VOLTAGE_HEATER_OK_THRESHOLD = 12.8
NO_SHUNT_CAVEAT = "No battery shunt installed - estimate based on voltage only, not precise"


class PowerPredictionProvider:
    def __init__(self, telemetry_service: TelemetryService, history_service: HistoryService) -> None:
        self._telemetry = telemetry_service
        self._history = history_service

    def predict(self) -> list[Prediction]:
        predictions: list[Prediction] = []
        battery_msg = self._telemetry.latest(TelemetryDomain.BATTERY)

        if battery_msg is not None:
            soc_pct = battery_msg.payload.get("soc_pct")
            voltage = battery_msg.payload.get("voltage")

            if soc_pct is not None:
                typical_load_watts = self._estimate_typical_load_watts()
                bank_wh_remaining = (soc_pct / 100.0) * NOMINAL_BANK_WH
                runtime_hours = round(min(999, bank_wh_remaining / typical_load_watts), 1) if typical_load_watts > 0 else None
                predictions.append(Prediction(key="estimated_runtime_hours", label="Estimated runtime", value=runtime_hours, unit="hours"))
                heater_ok = bank_wh_remaining > HEATER_ALL_NIGHT_WH_THRESHOLD
                predictions.append(Prediction(key="heater_all_night_possible", label="Heater all night", value=int(heater_ok), unit="bool"))
            else:
                predictions.append(
                    Prediction(key="estimated_runtime_hours", label="Estimated runtime", value=None, unit="hours", confidence=NO_SHUNT_CAVEAT)
                )
                heater_ok = voltage is not None and voltage > VOLTAGE_HEATER_OK_THRESHOLD
                predictions.append(
                    Prediction(key="heater_all_night_possible", label="Heater all night", value=int(heater_ok), unit="bool", confidence=NO_SHUNT_CAVEAT)
                )

        weather_msg = self._telemetry.latest(TelemetryDomain.WEATHER)
        if weather_msg is not None:
            today_mj = weather_msg.payload.get("today", {}).get("shortwave_radiation_sum_mj")
            tomorrow_mj = weather_msg.payload.get("tomorrow", {}).get("shortwave_radiation_sum_mj")
            if today_mj is not None:
                predictions.append(Prediction(key="solar_today_mj", label="Solar energy today", value=today_mj, unit="MJ/m²"))
            if tomorrow_mj is not None:
                predictions.append(Prediction(key="solar_tomorrow_mj", label="Solar energy tomorrow", value=tomorrow_mj, unit="MJ/m²"))

        return predictions

    def _estimate_typical_load_watts(self) -> float:
        """Verbatim from PowerBudgetService: derives a rough typical
        load from recent battery discharge rate if we have enough
        history; falls back to a fixed assumption otherwise.
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
