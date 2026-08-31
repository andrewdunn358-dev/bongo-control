"""
EnergyBalanceSignalProvider — the daily energy balance that
solar_history.py explicitly declined to fake.

Its note said it plainly: reporting a net figure needs draw integrated
over the same period from stored shunt history, not a single
instantaneous reading multiplied out. A SmartShunt has been fitted
since 29 August and its readings have been persisting to history ever
since, so that integration is now possible from measurements alone.
This is that provider.

WHAT IS MEASURED, AND WHAT IS NOT

The shunt sits in the battery's negative lead and reports `power_w` -
positive into the battery, negative out of it. Integrating that over a
day gives the day's NET change in stored energy, in watt-hours. That
number is measured end to end: no assumed capacity, no assumed load, no
model of the panels. Split into its positive and negative halves it
also gives charge_wh and discharge_wh, which are equally measured.

Total household LOAD is deliberately not reported. The shunt sees the
net at the battery post, so while the sun is out a 40 W load behind a
100 W array reads as +60 W and the load itself is invisible. Load could
be recovered as (solar in − net) only if solar were the sole charge
source, and on this van it isn't: the DC-DC charger tops the bank up
while driving and a mains charger does at home, neither of which is
logged as solar. That would quietly understate the load on exactly the
days it was most interesting. So harvest is reported because harvest is
measured, net is reported because net is measured, and load is left
out because it is not.

THE COVERAGE RULE, WHICH IS THE PART THAT ACTUALLY MATTERS

Integrating a gappy series produces a confidently wrong daily total.
If the shunt's Bluetooth drops for eight hours - and it has, for nine
hours straight when the Pi's Bluetooth controller locked up - the
remaining sixteen hours integrate to a number that looks entirely
plausible and is a third short. There is no way to tell that from the
figure itself.

So every day carries a coverage fraction: seconds actually accounted
for, over the seconds that day should have had. Gaps longer than
DT_CAP_SECONDS are excluded from the integral rather than being
extrapolated across (the same rule daily_solar_wh already uses), which
is what makes coverage measurable at all. Days below MIN_COVERAGE are
reported as incomplete and are never averaged, projected from, or
warned about. A day the van could not see is not a day with a low
number in it.
"""

from __future__ import annotations

import statistics
import time
from datetime import datetime, timezone

from app.intelligence.signals import Signal, SignalSeverity
from app.telemetry.models import TelemetryDomain, TelemetrySource

LOOKBACK_DAYS = 8
# Same cap as solar_history's integrator: a gap longer than this is an
# outage, not a steady reading held across it.
DT_CAP_SECONDS = 300
# A day has to be this well covered before its total means anything.
MIN_COVERAGE = 0.8
# Below this the day is a deficit worth mentioning rather than noise.
# Roughly a tenth of the nominal bank - smaller than that and a day's
# rounding could produce it.
DEFICIT_WH = 120.0
MIN_DAYS_FOR_TREND = 3
# Only used to turn an average deficit into "days until the floor",
# which is a projection and is labelled as one. Matches
# power_budget_service.NOMINAL_BANK_WH.
NOMINAL_BANK_WH = 100 * 12.8
AGM_FLOOR_FRACTION = 0.5


def _day(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat()


def daily_battery_energy(rows: list[dict]) -> dict[str, dict[str, float]]:
    """Per calendar day: net / charged / discharged watt-hours at the
    battery, plus how much of the day was actually covered by readings.

    Trapezoid-integrates `power_w` from BATTERY history, using only rows
    the SmartShunt itself published. That source filter is load-bearing
    rather than tidiness: the MPPT also publishes BATTERY, the bus
    merges the two payloads by precedence before anything is persisted,
    and so an MPPT-sourced row carries a COPY of the shunt's last
    `power_w`. Integrating both would count stretches of the day twice
    over, weighted by whichever device happened to broadcast more often.
    One device, one series.
    """
    by_day: dict[str, dict[str, float]] = {}
    prev: tuple[float, float] | None = None

    for row in sorted(rows, key=lambda r: r["timestamp"]):
        if row.get("source") != TelemetrySource.VICTRON_SHUNT.value:
            continue
        watts = row["payload"].get("power_w")
        ts = row["timestamp"]
        if watts is None or isinstance(watts, bool):
            prev = None  # a null breaks the series; don't bridge across it
            continue
        try:
            watts = float(watts)
        except (TypeError, ValueError):
            prev = None
            continue

        if prev is not None:
            dt = ts - prev[0]
            if 0 < dt <= DT_CAP_SECONDS:
                # Attribute the interval to the day it started in.
                # Splitting the handful of intervals that straddle
                # midnight would move a few watt-seconds between two
                # days and complicate every line here to do it.
                day = by_day.setdefault(
                    _day(prev[0]), {"net_wh": 0.0, "charge_wh": 0.0, "discharge_wh": 0.0, "covered_s": 0.0}
                )
                wh = (watts + prev[1]) / 2 * dt / 3600.0
                day["net_wh"] += wh
                if wh >= 0:
                    day["charge_wh"] += wh
                else:
                    day["discharge_wh"] += -wh
                day["covered_s"] += dt
        prev = (ts, watts)

    now = time.time()
    today = _day(now)
    seconds_into_today = now - datetime.fromisoformat(today).replace(tzinfo=timezone.utc).timestamp()
    for day, values in by_day.items():
        # Today is only ever partly elapsed, so its coverage is measured
        # against the part that has happened - otherwise every morning
        # would look like an outage.
        expected = seconds_into_today if day == today else 86400.0
        values["coverage"] = min(1.0, values["covered_s"] / expected) if expected > 0 else 0.0
    return by_day


class EnergyBalanceSignalProvider:
    def __init__(self, history_service) -> None:
        self._history = history_service

    def evaluate(self) -> Signal | None:
        since = time.time() - LOOKBACK_DAYS * 86400
        rows = self._history.query(TelemetryDomain.BATTERY.value, since)
        daily = daily_battery_energy(rows)
        if not daily:
            # No shunt history at all. Nothing to say, and deliberately
            # not an UNKNOWN signal - the Home card already reports the
            # absence of a shunt where that matters.
            return None

        today = _day(time.time())
        detail: dict = {}

        if today in daily:
            detail["today_net_wh"] = round(daily[today]["net_wh"])
            detail["today_charge_wh"] = round(daily[today]["charge_wh"])
            detail["today_discharge_wh"] = round(daily[today]["discharge_wh"])
            detail["today_coverage_pct"] = round(daily[today]["coverage"] * 100)

        complete = {
            day: values
            for day, values in daily.items()
            if day != today and values["coverage"] >= MIN_COVERAGE
        }
        incomplete = len([d for d in daily if d != today and d not in complete])
        if incomplete:
            # Counted and surfaced, not silently dropped - the same rule
            # the Coverage map applies to rows with no coordinates.
            detail["days_excluded_low_coverage"] = incomplete

        if len(complete) < MIN_DAYS_FOR_TREND:
            detail["days"] = len(complete)
            return Signal(
                source="energy_balance",
                severity=SignalSeverity.OK,
                message="Building up a daily energy balance — needs a few more full days of shunt data.",
                weight=1,
                detail=detail,
            )

        nets = [values["net_wh"] for values in complete.values()]
        avg_net = statistics.mean(nets)
        detail["days"] = len(complete)
        detail["avg_net_wh"] = round(avg_net)
        detail["best_net_wh"] = round(max(nets))
        detail["worst_net_wh"] = round(min(nets))

        if avg_net < -DEFICIT_WH:
            usable_wh = NOMINAL_BANK_WH * (1 - AGM_FLOOR_FRACTION)
            days_to_floor = max(1, round(usable_wh / abs(avg_net)))
            detail["days_to_floor"] = days_to_floor
            return Signal(
                source="energy_balance",
                severity=SignalSeverity.WARNING,
                message=(
                    f"Running an energy deficit of about {abs(avg_net):.0f} Wh a day over the last "
                    f"{len(complete)} full days. From a full bank that's roughly {days_to_floor} days "
                    f"to the 50% floor — worth a hookup or a longer drive."
                ),
                weight=2,
                detail=detail,
            )

        if avg_net > DEFICIT_WH:
            return Signal(
                source="energy_balance",
                severity=SignalSeverity.OK,
                message=f"Net positive — averaging about {avg_net:.0f} Wh a day back into the bank.",
                weight=1,
                detail=detail,
            )

        return Signal(
            source="energy_balance",
            severity=SignalSeverity.OK,
            message="Energy in and out are roughly balanced day to day.",
            weight=1,
            detail=detail,
        )
