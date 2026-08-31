"""
Energy balance tests. Run: python backend/test_energy_balance.py

Same standalone-script shape as test_roof_safety.py and
test_battery_alarms.py. Builds synthetic BATTERY history rows and
checks the integrator against totals worked out by hand, because the
whole value of this provider is that its number is arithmetic on real
measurements rather than a plausible-looking estimate - so the
arithmetic is the thing worth testing.
"""

import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from app.intelligence.providers.energy_balance import (  # noqa: E402
    DT_CAP_SECONDS,
    MIN_COVERAGE,
    EnergyBalanceSignalProvider,
    daily_battery_energy,
)
from app.intelligence.signals import SignalSeverity  # noqa: E402
from app.telemetry.models import TelemetrySource  # noqa: E402

failures = []


def check(label, condition, detail=""):
    print(f"  {'PASS' if condition else 'FAIL'}  {label}{f' [{detail}]' if detail and not condition else ''}")
    if not condition:
        failures.append(label)


def close(a, b, tol=1.0):
    return abs(a - b) <= tol


def midnight_utc(days_ago):
    """Start-of-day timestamp, days_ago whole days before today."""
    today = datetime.now(timezone.utc).date()
    return datetime.fromisoformat(today.isoformat()).replace(tzinfo=timezone.utc).timestamp() - days_ago * 86400


def rows_for_day(days_ago, watts, step=60, start_s=0, end_s=86400, source=None):
    """A row every `step` seconds across [start_s, end_s) of that day,
    all at a constant wattage. Constant so the expected watt-hours are
    trivially checkable by hand.
    """
    base = midnight_utc(days_ago)
    src = source or TelemetrySource.VICTRON_SHUNT.value
    return [
        {"timestamp": base + t, "source": src, "payload": {"power_w": watts}}
        for t in range(start_s, end_s, step)
    ]


class FakeHistory:
    def __init__(self, rows):
        self._rows = rows

    def query(self, domain, since_timestamp, max_points=None):
        return [r for r in self._rows if r["timestamp"] >= since_timestamp]


def main():
    print("=== 1. ARITHMETIC: a flat day integrates to the obvious number ===")
    # -10W held all day = -240 Wh. This van's measured 10W base load, so
    # the expected answer is one already known from the hardware.
    daily = daily_battery_energy(rows_for_day(1, -10.0))
    day = list(daily.values())[0]
    check("a steady 10W draw for 24h is -240 Wh", close(day["net_wh"], -240.0), f"got {day['net_wh']:.1f}")
    check("it is all discharge, no charge", close(day["charge_wh"], 0.0) and close(day["discharge_wh"], 240.0))
    check("coverage is ~100%", day["coverage"] > 0.99, f"got {day['coverage']:.3f}")

    print("\n=== 2. CHARGE AND DISCHARGE SPLIT, NOT JUST THE NET ===")
    # +100W for the first 12h, -100W for the second 12h -> net 0,
    # but 1200 Wh each way. A provider that only reported net would
    # call this identical to a van that did nothing all day.
    rows = rows_for_day(1, 100.0, end_s=43200) + rows_for_day(1, -100.0, start_s=43200)
    day = list(daily_battery_energy(rows).values())[0]
    check("net comes out at zero", abs(day["net_wh"]) < 25, f"got {day['net_wh']:.1f}")
    check("charge is ~1200 Wh", close(day["charge_wh"], 1200.0, 30), f"got {day['charge_wh']:.1f}")
    check("discharge is ~1200 Wh", close(day["discharge_wh"], 1200.0, 30), f"got {day['discharge_wh']:.1f}")

    print("\n=== 3. THE MPPT'S MERGED COPY IS NOT COUNTED TWICE ===")
    # The bus merges shunt fields into MPPT-sourced BATTERY messages, so
    # both sources persist rows carrying the same power_w. Integrating
    # both would roughly double the day.
    shunt = rows_for_day(1, -10.0)
    mppt = rows_for_day(1, -10.0, source=TelemetrySource.VICTRON_MPPT.value)
    day = list(daily_battery_energy(shunt + mppt).values())[0]
    check("still -240 Wh with MPPT rows interleaved", close(day["net_wh"], -240.0, 5), f"got {day['net_wh']:.1f}")

    print("\n=== 4. AN OUTAGE IS NOT EXTRAPOLATED ACROSS ===")
    # 12 hours of readings, then nothing. The naive answer is to bridge
    # the gap and report a full day; the honest one is half a day's
    # energy and half coverage.
    day = list(daily_battery_energy(rows_for_day(1, -10.0, end_s=43200)).values())[0]
    check("half a day of readings gives ~half the watt-hours", close(day["net_wh"], -120.0, 5), f"got {day['net_wh']:.1f}")
    check("and reports ~50% coverage, not 100%", 0.45 < day["coverage"] < 0.55, f"got {day['coverage']:.3f}")

    print("\n=== 5. GAPS LONGER THAN THE CAP ARE EXCLUDED, NOT BRIDGED ===")
    rows = rows_for_day(1, -10.0, end_s=3600) + rows_for_day(1, -10.0, start_s=3600 + DT_CAP_SECONDS * 4)
    day = list(daily_battery_energy(rows).values())[0]
    covered_hours = day["covered_s"] / 3600
    check(
        "the skipped window is missing from covered time",
        covered_hours < 24 - (DT_CAP_SECONDS * 4 / 3600) + 0.1,
        f"covered {covered_hours:.2f}h",
    )

    print("\n=== 6. NULLS BREAK THE SERIES RATHER THAN READING AS ZERO ===")
    rows = rows_for_day(1, -10.0, end_s=43200)
    rows.append({"timestamp": midnight_utc(1) + 43200, "source": TelemetrySource.VICTRON_SHUNT.value, "payload": {"power_w": None}})
    rows += rows_for_day(1, -10.0, start_s=50400)
    day = list(daily_battery_energy(rows).values())[0]
    check("a null is not integrated as 0W", close(day["net_wh"], -215.0, 10), f"got {day['net_wh']:.1f}")

    print("\n=== 7. LOW-COVERAGE DAYS ARE EXCLUDED FROM THE AVERAGE ===")
    # Three good deficit days plus one day the shunt was mostly offline.
    # The bad day's partial total is small and would drag the average
    # towards "fine" if it were counted.
    rows = []
    for d in (1, 2, 3):
        rows += rows_for_day(d, -20.0)          # -480 Wh/day
    rows += rows_for_day(4, -20.0, end_s=3600)  # 4% coverage, -20 Wh
    signal = EnergyBalanceSignalProvider(FakeHistory(rows)).evaluate()
    check("four days of rows, three counted", signal.detail["days"] == 3, f"got {signal.detail['days']}")
    check("the excluded day is reported, not dropped silently", signal.detail.get("days_excluded_low_coverage") == 1)
    check("average is the real -480, not diluted", close(signal.detail["avg_net_wh"], -480, 10), f"got {signal.detail['avg_net_wh']}")
    check("MIN_COVERAGE is what did it", MIN_COVERAGE > 0.04)

    print("\n=== 8. A DEFICIT WARNS, AND PROJECTS TO THE FLOOR ===")
    check("severity is WARNING", signal.severity == SignalSeverity.WARNING)
    check("names the deficit", "480" in signal.message, signal.message)
    # 640 Wh usable above the 50% floor / 480 Wh a day = 1.33 -> 1 day.
    check("projects days to the 50% floor", signal.detail["days_to_floor"] == 1, str(signal.detail.get("days_to_floor")))

    print("\n=== 9. A SURPLUS DOES NOT WARN ===")
    rows = []
    for d in (1, 2, 3):
        rows += rows_for_day(d, 20.0)
    signal = EnergyBalanceSignalProvider(FakeHistory(rows)).evaluate()
    check("severity is OK", signal.severity == SignalSeverity.OK)
    check("reports it as net positive", "positive" in signal.message.lower(), signal.message)
    check("no floor projection on a surplus", "days_to_floor" not in signal.detail)

    print("\n=== 10. NOT ENOUGH DATA SAYS SO RATHER THAN GUESSING ===")
    signal = EnergyBalanceSignalProvider(FakeHistory(rows_for_day(1, -20.0))).evaluate()
    check("one day is not a trend", signal.severity == SignalSeverity.OK)
    check("says it is still building up", "needs a few more" in signal.message, signal.message)
    check("no average published from one day", "avg_net_wh" not in signal.detail)

    print("\n=== 11. NO SHUNT HISTORY AT ALL IS SILENCE, NOT A ZERO ===")
    check("returns no signal", EnergyBalanceSignalProvider(FakeHistory([])).evaluate() is None)
    mppt_only = rows_for_day(1, -10.0, source=TelemetrySource.VICTRON_MPPT.value)
    check("MPPT rows alone produce no signal", EnergyBalanceSignalProvider(FakeHistory(mppt_only)).evaluate() is None)

    print("\n=== 12. TODAY IS REPORTED SEPARATELY FROM COMPLETE DAYS ===")
    now = time.time()
    elapsed = now - midnight_utc(0)
    if elapsed > 3600:
        rows = []
        for d in (1, 2, 3):
            rows += rows_for_day(d, -20.0)
        rows += rows_for_day(0, -10.0, end_s=int(elapsed))
        signal = EnergyBalanceSignalProvider(FakeHistory(rows)).evaluate()
        check("today's figure is present", "today_net_wh" in signal.detail)
        check("today is not counted as a complete day", signal.detail["days"] == 3)
        check(
            "today's coverage is measured against elapsed time, not 24h",
            signal.detail["today_coverage_pct"] > 90,
            f"got {signal.detail.get('today_coverage_pct')}",
        )
    else:
        print("  SKIP  too early in the UTC day to test today's partial coverage")

    print()
    if failures:
        print(f"{len(failures)} FAILURE(S):")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print("All energy balance tests passed.")


if __name__ == "__main__":
    main()
