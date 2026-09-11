"""
Intelligence runner tests. Run: python backend/test_intelligence_runner.py

Same shape as test_battery_alarms.py - a standalone script, no pytest
dependency on the Pi. Drives IntelligenceRunner._run() against a fake
telemetry service (an asyncio.Queue it can feed messages into) and a
fake engine that records which thread compute() ran on - so this
proves the off-thread change actually keeps the recompute off the
event loop, not just that it "doesn't crash".
"""

import asyncio
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from app.intelligence.runner import RECOMPUTE_MIN_INTERVAL_SECONDS, IntelligenceRunner  # noqa: E402
from app.telemetry.models import TelemetryDomain, TelemetryMessage, TelemetrySource  # noqa: E402

failures = []


def check(label, condition):
    print(f"  {'PASS' if condition else 'FAIL'}  {label}")
    if not condition:
        failures.append(label)


class FakeTelemetryService:
    """Just enough of TelemetryService for the runner's subscribe/
    unsubscribe/latest calls - a plain asyncio.Queue, fed directly by
    the test rather than a real bus."""

    def __init__(self):
        self.queue: asyncio.Queue = asyncio.Queue()

    def subscribe(self):
        return self.queue

    def unsubscribe(self, queue):
        pass

    async def put(self, domain: TelemetryDomain, source: TelemetrySource = TelemetrySource.SIMULATION):
        await self.queue.put(TelemetryMessage(domain=domain, source=source, payload={}))


class FakeEngine:
    """Records every compute() call: when it ran and which thread it
    ran on, so the test can assert the runner actually hands it to
    asyncio.to_thread rather than calling it inline."""

    def __init__(self, delay: float = 0.0):
        self.calls: list[dict] = []
        self._delay = delay

    def compute(self):
        if self._delay:
            time.sleep(self._delay)
        self.calls.append({"at": time.time(), "thread": threading.current_thread().name})


async def main():
    print("=== 1. RECOMPUTE RUNS OFF THE EVENT LOOP THREAD ===")
    telemetry = FakeTelemetryService()
    engine = FakeEngine()
    runner = IntelligenceRunner(telemetry, engine)
    task = asyncio.create_task(runner._run())
    await telemetry.put(TelemetryDomain.BATTERY)
    await asyncio.sleep(0.2)  # let the queued message reach engine.compute()
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    check("compute() ran exactly once", len(engine.calls) == 1)
    check(
        "compute() ran on a worker thread, not the event loop's own thread",
        engine.calls and engine.calls[0]["thread"] != threading.current_thread().name,
    )

    print("\n=== 2. A SLOW COMPUTE() DOES NOT BLOCK OTHER ASYNCIO WORK ===")
    telemetry = FakeTelemetryService()
    engine = FakeEngine(delay=0.3)  # simulate a real Pi-2B-scale DB read
    runner = IntelligenceRunner(telemetry, engine)
    task = asyncio.create_task(runner._run())
    await telemetry.put(TelemetryDomain.BATTERY)

    # A stand-in for the roof watchdog / camera loop: something else on
    # the event loop that should keep ticking on schedule regardless of
    # how long engine.compute() takes on its worker thread.
    ticks = []

    async def watchdog():
        for _ in range(6):
            ticks.append(time.time())
            await asyncio.sleep(0.05)

    await watchdog()
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    gaps = [b - a for a, b in zip(ticks, ticks[1:])]
    check("compute() actually ran (and took the simulated delay)", len(engine.calls) == 1)
    check(
        "the 'watchdog' ticked on its own schedule instead of stalling behind compute()",
        all(gap < 0.15 for gap in gaps),
    )

    print("\n=== 3. IRRELEVANT DOMAINS ARE IGNORED ===")
    telemetry = FakeTelemetryService()
    engine = FakeEngine()
    runner = IntelligenceRunner(telemetry, engine)
    task = asyncio.create_task(runner._run())
    await telemetry.put(TelemetryDomain.CONNECTIVITY)
    await asyncio.sleep(0.1)
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    check("a non-BATTERY/WEATHER message triggers no recompute", len(engine.calls) == 0)

    print("\n=== 4. THE 30s THROTTLE STILL WORKS ===")
    telemetry = FakeTelemetryService()
    engine = FakeEngine()
    runner = IntelligenceRunner(telemetry, engine)
    runner._last_computed_at = time.time()  # pretend a compute just happened
    task = asyncio.create_task(runner._run())
    await telemetry.put(TelemetryDomain.BATTERY)
    await asyncio.sleep(0.1)
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    check(f"a message inside the {RECOMPUTE_MIN_INTERVAL_SECONDS}s window is throttled, not recomputed", len(engine.calls) == 0)

    print()
    if failures:
        print(f"{len(failures)} FAILURE(S):")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print("All intelligence runner tests passed.")


if __name__ == "__main__":
    asyncio.run(main())
