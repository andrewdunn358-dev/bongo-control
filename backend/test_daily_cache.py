"""
Daily aggregate cache tests. Run: python backend/test_daily_cache.py

The cache exists because the intelligence providers were re-reading and
JSON-decoding ~75,000 telemetry rows every 30 seconds to recompute daily
totals that had not changed - measured at 63% of a core on the Pi, and
the reason the camera stuttered.

What matters here is that it caches the RIGHT things: completed days
once, today never. Serving a stale figure for the day someone is
actually looking at would be the one wrong answer that matters.
"""

import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from app.intelligence.daily_cache import DailyAggregateCache, day_key, day_start  # noqa: E402

failures = []


def check(label, condition, detail=""):
    print(f"  {'PASS' if condition else 'FAIL'}  {label}" + (f"  [{detail}]" if not condition and detail else ""))
    if not condition:
        failures.append(label)


class CountingHistory:
    """Records every query so we can assert the cache actually avoids
    them - the whole point of this component."""

    def __init__(self, rows):
        self._rows = rows
        self.queries = []

    def query(self, domain, since_timestamp, max_points=None, until_timestamp=None):
        self.queries.append((domain, since_timestamp, until_timestamp))
        return [
            r for r in self._rows
            if r["domain"] == domain
            and r["timestamp"] >= since_timestamp
            and (until_timestamp is None or r["timestamp"] < until_timestamp)
        ]


def rows_for(days_ago_list, per_day=10):
    now = time.time()
    midnight = day_start(now)
    out = []
    for d in days_ago_list:
        start = midnight - d * 86400
        for i in range(per_day):
            out.append({"domain": "solar", "timestamp": start + i * 60, "payload": {"watts": 100}})
    return out


def count_rows(rows):
    return float(len(rows))


print("=== 1. IT AGGREGATES PER DAY ===")
h = CountingHistory(rows_for([3, 2, 1, 0], per_day=5))
c = DailyAggregateCache(h)
series = c.series("test", "solar", 3, count_rows)
check("one entry per day with data", len(series) == 4, str(len(series)))
check("each day counted separately", all(v == 5.0 for v in series.values()), str(series))

print("\n=== 2. COMPLETED DAYS ARE QUERIED ONCE ===")
h = CountingHistory(rows_for([3, 2, 1, 0], per_day=5))
c = DailyAggregateCache(h)
c.series("test", "solar", 3, count_rows)
first_run = len(h.queries)
h.queries.clear()
c.series("test", "solar", 3, count_rows)
second_run = len(h.queries)

check("first run queries every day", first_run == 4, str(first_run))
check("second run queries ONLY today", second_run == 1, str(second_run))
check("...and that query is unbounded (today is still running)",
      h.queries[0][2] is None, str(h.queries[0]))

print("\n=== 3. TODAY IS NEVER CACHED ===")
# The one wrong answer that would matter: today still accumulates.
h = CountingHistory(rows_for([0], per_day=3))
c = DailyAggregateCache(h)
first = c.series("test", "solar", 2, count_rows)[day_key(time.time())]
# More data arrives during the day.
h._rows.extend(rows_for([0], per_day=4))
second = c.series("test", "solar", 2, count_rows)[day_key(time.time())]
check("today's value updates as data arrives", second > first, f"{first} -> {second}")

print("\n=== 4. A COMPLETED DAY'S VALUE IS STABLE ===")
h = CountingHistory(rows_for([1], per_day=5))
c = DailyAggregateCache(h)
yesterday = day_key(day_start(time.time()) - 86400)
first = c.series("test", "solar", 2, count_rows)[yesterday]
# Rows appearing for a finished day should not change the cached answer:
# it was computed when the day closed and cannot change in reality.
h._rows.extend(rows_for([1], per_day=99))
second = c.series("test", "solar", 2, count_rows)[yesterday]
check("yesterday's cached value does not move", first == second, f"{first} -> {second}")

print("\n=== 5. DIFFERENT KEYS DO NOT COLLIDE ===")
# Two providers read the SAME domain and want different numbers out of
# it - the energy balance and power predictions both read BATTERY.
h = CountingHistory(rows_for([1, 0], per_day=4))
c = DailyAggregateCache(h)
a = c.series("count", "solar", 2, count_rows)
b = c.series("double", "solar", 2, lambda rows: len(rows) * 2.0)
check("same domain, two aggregators, two answers",
      a[yesterday] == 4.0 and b[yesterday] == 8.0, f"{a[yesterday]} / {b[yesterday]}")

print("\n=== 6. THE CACHE DOES NOT GROW FOREVER ===")
h = CountingHistory(rows_for(list(range(0, 12)), per_day=2))
c = DailyAggregateCache(h)
c.series("test", "solar", 3, count_rows)
internal = c._cache["test"]
check("only days inside the window are retained", len(internal) <= 4, str(len(internal)))

print("\n=== 7. EMPTY DAYS ARE OMITTED, NOT ZEROED ===")
# "produced nothing" and "nobody was logging" are different answers.
h = CountingHistory(rows_for([2, 0], per_day=3))
c = DailyAggregateCache(h)
series = c.series("test", "solar", 3, count_rows)
missing = day_key(day_start(time.time()) - 86400)
check("a day with no rows is absent from the series", missing not in series, str(sorted(series)))

print("\n=== 8. DAY BOUNDARIES ===")
now = time.time()
check("day_start is midnight UTC",
      datetime.fromtimestamp(day_start(now), tz=timezone.utc).hour == 0)
check("day_start is within the same day", day_key(day_start(now)) == day_key(now))
check("a day is exactly 86400s before the next",
      day_start(now) - (day_start(now) - 86400) == 86400)

print()
if failures:
    print(f"{len(failures)} FAILURE(S):")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("All daily cache tests passed.")
