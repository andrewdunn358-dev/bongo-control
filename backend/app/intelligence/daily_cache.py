"""
Per-day aggregate cache for the intelligence providers.

THE PROBLEM THIS SOLVES
Every provider that looks at history did the same thing: ask for eight
days of rows, bucket them by calendar day, use the buckets. The
intelligence engine recomputes every 30 seconds, so on this van that
meant re-reading and JSON-decoding, per run:

    solar     10,656 rows
    weather      338 rows
    battery   31,833 rows  (twice - energy balance and power predictions)

about 75,000 rows every 30 seconds, roughly 7 million JSON decodes an
hour, on the event loop, on a Pi 2B. It was measured at 63% of a core
with py-spy sitting in `json.loads` inside `history_service.query`, and
it is why the camera stuttered: the loop was busy parsing JSON instead
of proxying frames.

It also grows. The table was at 154,000 rows, so it got slower daily.

THE OBSERVATION
Seven of those eight days are FINISHED. Yesterday's solar total cannot
change. Only today's can. So a completed day is computed once and kept,
and each run re-reads only today - roughly a 90% cut without touching
the schema or losing any accuracy.

WHY PER-DAY QUERIES RATHER THAN ONE BIG ONE
A bounded window per day is what makes caching possible at all. It does
mean the interval spanning midnight is attributed to the day it starts
in rather than being split - which is exactly what these aggregators
already did when given the whole range, and the energy balance provider
already documents why (splitting would move a few watt-seconds between
two days and complicate every line to do it).

WHAT IS DELIBERATELY NOT CACHED
Today. Ever. It is still accumulating, and serving a stale figure for
the day someone is actually looking at would be the one wrong answer
that matters.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any, Callable


def day_key(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat()


def day_start(ts: float) -> float:
    """Midnight UTC at the start of the day containing ts."""
    d = datetime.fromtimestamp(ts, tz=timezone.utc).date()
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp()


class DailyAggregateCache:
    """Caches one aggregate value per completed calendar day.

    `aggregate` is given that day's rows and returns whatever the caller
    wants - a float for solar watt-hours, a dict for the energy balance's
    net/charge/discharge/coverage. The cache does not care.

    Keyed by a caller-supplied name as well as the domain, because two
    providers can aggregate the SAME domain differently: the energy
    balance and power predictions both read BATTERY and want different
    numbers out of it.
    """

    def __init__(self, history_service) -> None:
        self._history = history_service
        self._cache: dict[str, dict[str, Any]] = {}

    def series(
        self,
        key: str,
        domain: str,
        lookback_days: int,
        aggregate: Callable[[list[dict]], Any],
    ) -> dict[str, Any]:
        """{day -> aggregate(rows for that day)} for the last
        lookback_days, today included."""
        now = time.time()
        today = day_key(now)
        today_start = day_start(now)

        cached = self._cache.setdefault(key, {})
        out: dict[str, Any] = {}

        for offset in range(lookback_days, -1, -1):
            start = today_start - offset * 86400
            day = day_key(start)

            if day == today:
                # Always fresh - see the note in the module docstring.
                rows = self._history.query(domain, start)
                value = aggregate(rows)
            elif day in cached:
                value = cached[day]
            else:
                rows = self._history.query(domain, start, until_timestamp=start + 86400)
                value = aggregate(rows)
                cached[day] = value

            # A day with no data at all is omitted rather than recorded
            # as zero: "the van produced nothing" and "nobody was
            # logging" are different answers, and every caller here
            # treats a missing day as unknown.
            if value not in (None, {}, 0.0) or day == today:
                out[day] = value

        # Drop days that have fallen out of the window, or the cache
        # grows forever on a van that stays powered for months.
        horizon = day_key(today_start - lookback_days * 86400)
        for stale in [d for d in cached if d < horizon]:
            del cached[stale]

        return out

    def invalidate(self) -> None:
        """Forget everything. Only needed if history is deleted or
        back-filled behind us - normal operation never requires it."""
        self._cache.clear()
