"""
PowerPredictionProvider — the numeric half of the old
PowerBudgetService (estimated runtime, heater-tonight, solar energy
figures), carried over including the typical-load-from-discharge-rate
estimation. That service has since been deleted; this is now the only
place these figures are computed.
"""

from __future__ import annotations

import time

from app.services.history_service import HistoryService
from app.services.telemetry_service import TelemetryService
from app.telemetry.models import TelemetryDomain
from app.intelligence.signals import Prediction

DEFAULT_TYPICAL_LOAD_WATTS = 50.0  # used only when no real load history exists to estimate from
# Below this, a "load" is measurement noise rather than a reading: the
# Pi alone draws several watts continuously, so anything under this
# cannot be the van's real standing draw. Without this floor a near-zero
# figure divides into the bank capacity and yields absurd runtimes.
MIN_CREDIBLE_LOAD_WATTS = 5.0
# Runtime ceiling for DISPLAY. Beyond a few days the estimate is not
# meaningful - it assumes today's draw continues unchanged with no solar
# and nothing switched on - so it is capped rather than printed to one
# decimal place as though it were precise.
MAX_CREDIBLE_RUNTIME_HOURS = 168.0
HEATER_ALL_NIGHT_WH_THRESHOLD = 120 * 8
VOLTAGE_HEATER_OK_THRESHOLD = 12.8
# Two situations that read very differently to someone who has just
# fitted a shunt. Presence of current_a is the test - only a shunt
# reports it - and a SmartShunt gives no SoC until it has seen a full
# charge, which can be days later.
NO_SHUNT_CAVEAT = "No battery shunt installed - estimate based on voltage only, not precise"
SHUNT_UNSYNCED_CAVEAT = "Shunt fitted but not yet synchronised - needs a full charge before it can report a percentage"


# See battery_signal.py for why current_a alone is not a safe test.
_SHUNT_FIELDS = ("current_a", "power_w", "consumed_ah", "time_remaining_mins")


def _caveat(payload: dict) -> str:
    fitted = any(payload.get(f) is not None for f in _SHUNT_FIELDS)
    return SHUNT_UNSYNCED_CAVEAT if fitted else NO_SHUNT_CAVEAT


class PowerPredictionProvider:
    def __init__(self, telemetry_service: TelemetryService, history_service: HistoryService, battery_bank_service) -> None:
        self._telemetry = telemetry_service
        self._history = history_service
        # Bank capacity is no longer a constant: the external 130Ah
        # battery is paralleled on and off through an Anderson
        # connector, so "how much battery is there" is a live question.
        # See battery_bank_service.py.
        self._bank = battery_bank_service

    def predict(self) -> list[Prediction]:
        predictions: list[Prediction] = []
        battery_msg = self._telemetry.latest(TelemetryDomain.BATTERY)

        if battery_msg is not None:
            soc_pct = battery_msg.payload.get("soc_pct")
            voltage = battery_msg.payload.get("voltage")

            if soc_pct is not None:
                typical_load_watts = self._estimate_typical_load_watts()
                bank = self._bank.capacity(battery_msg.payload)
                bank_wh_remaining = (soc_pct / 100.0) * bank["watt_hours"]
                runtime_hours = round(min(MAX_CREDIBLE_RUNTIME_HOURS, bank_wh_remaining / typical_load_watts), 1) if typical_load_watts > 0 else None
                # The estimate more than doubles when the external
                # battery is paralleled on, so which bank it assumed is
                # not a footnote - without it the number looks like it
                # jumped for no reason.
                bank_note = f"{bank['amp_hours']:.0f}Ah bank — {bank['reason']}"
                predictions.append(
                    Prediction(key="estimated_runtime_hours", label="Estimated runtime", value=runtime_hours, unit="hours", confidence=bank_note)
                )
                heater_ok = bank_wh_remaining > HEATER_ALL_NIGHT_WH_THRESHOLD
                # Yes/No, not a raw int(bool) with a fake "bool" unit - the
                # unit field is for real physical units (hours, MJ/m²); a
                # boolean isn't one, and shoehorning it in as int + unit
                # rendered literally as "0 bool" in the UI. Prediction.value
                # accepts str for exactly this case.
                predictions.append(Prediction(key="heater_all_night_possible", label="Heater all night", value="Yes" if heater_ok else "No"))
            else:
                predictions.append(
                    Prediction(key="estimated_runtime_hours", label="Estimated runtime", value=None, unit="hours", confidence=_caveat(battery_msg.payload))
                )
                heater_ok = voltage is not None and voltage > VOLTAGE_HEATER_OK_THRESHOLD
                predictions.append(
                    Prediction(key="heater_all_night_possible", label="Heater all night", value="Yes" if heater_ok else "No", confidence=_caveat(battery_msg.payload))
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
        """Typical discharge load in watts.

        PREFERS MEASURED POWER. The SmartShunt reports actual
        power_w/current_a continuously, and that is real data. The
        previous version ignored it and inferred load from the SoC
        DELTA across a 6h window instead - which divides by measurement
        noise: SoC is reported in coarse steps, so a single step of
        drift over six hours implies a load of a few watts and produced
        an "estimated runtime" of 326.6 hours (13.6 days) on a van that
        will not do anything of the sort. The number also wandered
        wildly between refreshes (948 -> 62 -> 326) because it was
        tracking quantisation, not consumption.

        Averages only DISCHARGING samples: including charging samples
        would net solar against load and understate the draw. Falls
        back to the SoC-delta method, then to a fixed assumption, so
        this still works on an install with no shunt.
        """
        recent = self._history.query(TelemetryDomain.BATTERY.value, time.time() - 6 * 3600)

        # 1. Measured power, discharge only. power_w is signed: negative
        #    while discharging on this shunt, so take the magnitude of
        #    the negative samples.
        discharging = [
            -r["payload"]["power_w"]
            for r in recent
            if r["payload"].get("power_w") is not None and r["payload"]["power_w"] < 0
        ]
        if discharging:
            measured = sum(discharging) / len(discharging)
            if measured >= MIN_CREDIBLE_LOAD_WATTS:
                return measured

        # 2. Fall back to the old SoC-delta inference.
        socs = [(r["timestamp"], r["payload"].get("soc_pct")) for r in recent if r["payload"].get("soc_pct") is not None]
        if len(socs) < 2:
            return DEFAULT_TYPICAL_LOAD_WATTS

        (t0, soc0), (t1, soc1) = socs[0], socs[-1]
        elapsed_hours = (t1 - t0) / 3600
        if elapsed_hours <= 0 or soc1 >= soc0:
            return DEFAULT_TYPICAL_LOAD_WATTS  # net charging over the window, can't infer a discharge rate

        soc_drop = soc0 - soc1
        # Same capacity question in reverse: a percentage drop is a
        # different number of watt-hours depending on how much battery
        # was connected while it happened.
        wh_used = (soc_drop / 100.0) * self._bank.watt_hours()
        watts = wh_used / elapsed_hours
        # Below the credible floor this is noise, not a reading - a van
        # with the Pi running cannot actually be drawing 2W.
        return watts if watts >= MIN_CREDIBLE_LOAD_WATTS else DEFAULT_TYPICAL_LOAD_WATTS
