"""
SolarHistorySignalProvider — recommendations from the van's own logged
solar history, all derived from real measurements (never fabricated):

  1. A rolling harvest summary (today so far, recent daily average, best
     recent day) - attached as signal `detail` for the Home card.

  2. A down-trend warning - if recent days' harvest has dropped well
     below the preceding days', a heads-up to top up devices. Solar-only,
     so it works from day one (SOLAR telemetry is already logged).

  3. A self-calibrating panel-performance check - the clever bit. For
     each complete day it computes harvested Wh ÷ that day's forecast
     solar radiation (MJ/m²). Because the forecast radiation already
     accounts for cloud, that ratio is "energy converted per unit of
     *available* sunlight" - which is roughly constant for a healthy
     array and drops when panels are shaded, dirty or faulty, regardless
     of the weather. If the latest complete day's ratio falls well below
     the recent median, it flags a possible panel problem. This needs a
     few days of *weather* history to calibrate, so it stays silent until
     that exists (weather only started being persisted recently) and then
     switches on by itself - no redeploy, no fabricated confidence.

Deliberately NOT an energy *balance* ("you're netting +X Wh/day"): total
van draw isn't measurable without a battery shunt (the same reason the
app shows voltage, not a guessed SoC %), so a net figure would be
exactly the kind of number this project refuses to invent. Harvest is
measured, so harvest is what's reported.
"""

from __future__ import annotations

import statistics
import time
from datetime import datetime, timezone

from app.intelligence.signals import Signal, SignalSeverity
from app.telemetry.models import TelemetryDomain

LOOKBACK_DAYS = 8
DT_CAP_SECONDS = 300  # ignore gaps bigger than this when integrating
TREND_DROP = 0.6      # recent avg below 60% of earlier avg => warn
PERF_DROP = 0.6       # latest ratio below 60% of median => possible fault
MIN_PERF_DAYS = 4     # need this many (day, radiation) pairs to calibrate


def _day(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat()


def daily_solar_wh(rows: list[dict]) -> dict[str, float]:
    """Harvested Wh per calendar day, trapezoid-integrating the `watts`
    field of SOLAR history. Works for both the Victron plugin and the
    simulation (both publish `watts`); large sampling gaps are capped so
    an outage doesn't get counted as steady production across it.
    """
    by_day: dict[str, float] = {}
    prev: tuple[float, float] | None = None
    for r in sorted(rows, key=lambda x: x["timestamp"]):
        watts = r["payload"].get("watts")
        ts = r["timestamp"]
        if watts is None:
            prev = None
            continue
        if prev is not None:
            dt = min(ts - prev[0], DT_CAP_SECONDS)
            if dt > 0:
                wh = (watts + prev[1]) / 2 * dt / 3600.0
                by_day[_day(prev[0])] = by_day.get(_day(prev[0]), 0.0) + wh
        prev = (ts, watts)
    return by_day


def daily_radiation_mj(rows: list[dict]) -> dict[str, float]:
    """Forecast solar radiation (MJ/m²) per day, from WEATHER history -
    the last reading of each day, since `today` in the payload refers to
    the day the reading was taken.
    """
    by_day: dict[str, float] = {}
    for r in sorted(rows, key=lambda x: x["timestamp"]):
        mj = (r["payload"].get("today") or {}).get("shortwave_radiation_sum_mj")
        if mj is not None:
            by_day[_day(r["timestamp"])] = mj
    return by_day


class SolarHistorySignalProvider:
    def __init__(self, history_service) -> None:
        self._history = history_service

    def evaluate(self) -> Signal | None:
        since = time.time() - LOOKBACK_DAYS * 86400
        daily = daily_solar_wh(self._history.query(TelemetryDomain.SOLAR.value, since))
        if not daily:
            return None  # no solar history yet - nothing to say

        today = _day(time.time())
        complete = {d: wh for d, wh in daily.items() if d != today}
        ordered_days = sorted(complete)  # oldest -> newest

        detail: dict = {"today_wh": round(daily.get(today, 0.0))}
        if complete:
            detail["avg_wh"] = round(sum(complete.values()) / len(complete))
            detail["best_wh"] = round(max(complete.values()))
            detail["days"] = len(complete)

        # --- panel performance (needs weather history to calibrate) ---
        rad = daily_radiation_mj(self._history.query(TelemetryDomain.WEATHER.value, since))
        ratios = {
            d: complete[d] / rad[d]
            for d in complete
            if d in rad and rad[d] > 3.0 and complete[d] is not None
        }
        if len(ratios) >= MIN_PERF_DAYS:
            typical = statistics.median(ratios.values())
            last_day = max(ratios)
            r_last = ratios[last_day]
            if typical > 0 and r_last < PERF_DROP * typical:
                pct = round(r_last / typical * 100)
                detail["performance_pct"] = pct
                return Signal(
                    source="solar_history",
                    severity=SignalSeverity.WARNING,
                    message=(
                        f"Solar panels converted only ~{pct}% of their usual energy for the "
                        f"available sunlight ({last_day}) — worth checking for shading, dirt or a fault."
                    ),
                    weight=2,
                    detail=detail,
                )

        # --- harvest down-trend (solar-only, works immediately) ---
        if len(ordered_days) >= 4:
            values = [complete[d] for d in ordered_days]
            recent = statistics.mean(values[-2:])
            earlier = statistics.mean(values[:-2])
            if earlier > 200 and recent < TREND_DROP * earlier:
                pct = round((1 - recent / earlier) * 100)
                detail["trend_down_pct"] = pct
                return Signal(
                    source="solar_history",
                    severity=SignalSeverity.WARNING,
                    message=(
                        f"Solar harvest is down ~{pct}% over the last couple of days — "
                        f"top up devices and go easy on power while it lasts."
                    ),
                    weight=1,
                    detail=detail,
                )

        # Nothing actionable - carry the summary numbers as an OK signal
        # (won't appear as a recommendation, but the Home card reads it).
        return Signal(
            source="solar_history",
            severity=SignalSeverity.OK,
            message="Solar harvest steady.",
            weight=1,
            detail=detail,
        )
