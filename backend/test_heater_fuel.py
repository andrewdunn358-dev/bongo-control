"""
Heater fuel estimation tests. Run: python backend/test_heater_fuel.py

The figures here are MODELLED, not measured - the heater does not report
fuel use. So what these tests protect is not accuracy against reality
(impossible without a flow meter) but that the integration is
arithmetically right and that gaps are not silently filled with invented
fuel.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from app.services.heater_fuel_service import DT_CAP_SECONDS, day_litres  # noqa: E402

failures = []


def check(label, condition, detail=""):
    print(f"  {'PASS' if condition else 'FAIL'}  {label}" + (f"  [{detail}]" if not condition and detail else ""))
    if not condition:
        failures.append(label)


def rows(pairs):
    """[(seconds_from_start, litres_per_hour_or_None)] -> history rows."""
    base = 1_700_000_000
    return [{"timestamp": base + t, "payload": {"fuel_lph": r}} for t, r in pairs]


print("=== 1. THE ARITHMETIC ===")
# One hour at a steady 0.32 L/h = 0.32 litres. Sampled every 60s.
steady = rows([(i * 60, 0.32) for i in range(61)])
check("one hour at 0.32 L/h is 0.32 L", abs(day_litres(steady) - 0.32) < 0.001, str(day_litres(steady)))

half = rows([(i * 60, 0.52) for i in range(31)])
check("half an hour at 0.52 L/h is 0.26 L", abs(day_litres(half) - 0.26) < 0.001, str(day_litres(half)))

print("\n=== 2. A RATE CHANGE IS AVERAGED ACROSS THE INTERVAL ===")
# NOTE: sample spacing here is 60s throughout, matching what the history
# service actually records. An earlier version of this test used samples
# an hour apart and "failed" - correctly, because a 3600s gap trips the
# DT_CAP. The test data was unrealistic, not the code.
#
# 0.16 rising to 0.52 across an hour, sampled every minute, should
# integrate to the mean rate of 0.34 L.
steps = [(i * 60, 0.16 + (0.52 - 0.16) * i / 60) for i in range(61)]
check("trapezoid, not last-value-wins",
      abs(day_litres(rows(steps)) - 0.34) < 0.005, str(day_litres(rows(steps))))

print("\n=== 3. OFF PERIODS DO NOT BURN FUEL ===")
# The important one: the heater either burns or it does not. Averaging
# across an off period would smear fuel into hours it was not running.
# An hour of burning, an hour off, an hour of burning - sampled every
# 60s as the history service does.
burn_a = [(i * 60, 0.32) for i in range(61)]
off = [(3600 + i * 60, None) for i in range(1, 61)]
burn_b = [(7200 + i * 60, 0.32) for i in range(61)]
total = day_litres(rows(burn_a + off + burn_b))
check("two burning hours either side of an off period = 0.64 L",
      abs(total - 0.64) < 0.02, str(total))

only_off = rows([(i * 60, None) for i in range(61)])
check("an entirely off day is 0.0 L", day_litres(only_off) == 0.0, str(day_litres(only_off)))

print("\n=== 4. A DATA GAP DOES NOT INVENT FUEL ===")
# Backend down for six hours between two burning samples. Without the
# cap this would claim six hours of burning that may never have
# happened.
long_gap = rows([(0, 0.32), (6 * 3600, 0.32)])
capped = day_litres(long_gap)
uncapped_would_be = 0.32 * 6
check("a six-hour gap is capped, not integrated whole",
      capped < 0.05, f"{capped} vs {uncapped_would_be} uncapped")
check("...and the cap is the documented 5 minutes",
      abs(capped - 0.32 * DT_CAP_SECONDS / 3600) < 0.001, str(capped))

print("\n=== 5. EDGES ===")
check("no rows is 0.0, not an error", day_litres([]) == 0.0)
check("a single row cannot integrate, so 0.0", day_litres(rows([(0, 0.32)])) == 0.0)
shuffled = rows([(120, 0.32), (0, 0.32), (60, 0.32)])
check("out-of-order rows are sorted first",
      abs(day_litres(shuffled) - 0.32 * 120 / 3600) < 0.001, str(day_litres(shuffled)))

print("\n=== 6. A REALISTIC NIGHT ===")
# Eight hours in temperature mode, which estimates mid-table at 0.32.
night = rows([(i * 60, 0.32) for i in range(8 * 60 + 1)])
litres = day_litres(night)
check(f"an eight-hour night is about 2.6 L (got {litres})", 2.5 < litres < 2.7, str(litres))

print()
if failures:
    print(f"{len(failures)} FAILURE(S):")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("All heater fuel tests passed.")
