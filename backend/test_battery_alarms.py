"""
Battery alarm tests. Run: python backend/test_battery_alarms.py

Same shape as test_roof_safety.py - a standalone script with fakes, no
pytest dependency on the Pi. Drives BatteryAlarmService.evaluate()
directly with synthetic payloads and a fake clock, so six hours of
re-notify behaviour and ten minutes of sustained divergence take no
wall-clock time at all.
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from app.services.battery_alarm_service import (  # noqa: E402
    DIVERGENCE_SUSTAIN_SECONDS,
    BatteryAlarmService,
)

failures = []


def check(label, condition):
    print(f"  {'PASS' if condition else 'FAIL'}  {label}")
    if not condition:
        failures.append(label)


class FakeNotifications:
    def __init__(self):
        self.sent = []

    async def notify(self, level, title, message):
        self.sent.append((level.value, title, message))


class FakeConfig:
    def __init__(self, alarms):
        self._alarms = alarms

    def get(self, section, default=None):
        return self._alarms if section == "alarms" else (default or {})


class FakeClock:
    def __init__(self):
        self.t = 1_700_000_000.0

    def __call__(self):
        return self.t

    def advance(self, seconds):
        self.t += seconds


def fresh(**overrides):
    alarms = {
        "battery_enabled": True,
        "soc_floor_pct": 50.0,
        "divergence_volts": 0.4,
        "renotify_hours": 6,
        "ntfy_topic": "",  # no push in tests - never touch the network
    }
    alarms.update(overrides)
    notifications = FakeNotifications()
    clock = FakeClock()
    svc = BatteryAlarmService(
        telemetry_service=None,  # evaluate() is called directly; the loop isn't started
        notification_service=notifications,
        configuration_service=FakeConfig(alarms),
        now=clock,
    )
    return svc, notifications, clock


async def main():
    print("=== 1. DISABLED BY DEFAULT (nothing fires) ===")
    svc, notes, _ = fresh(battery_enabled=False)
    await svc.evaluate({"soc_pct": 12.0, "voltage": 12.9, "external_voltage": 11.5})
    check("a flat, wildly diverging bank raises nothing while disabled", notes.sent == [])

    print("\n=== 2. SoC FLOOR ===")
    svc, notes, clock = fresh()
    await svc.evaluate({"soc_pct": 62.0})
    check("above the floor is silent", len(notes.sent) == 0)

    await svc.evaluate({"soc_pct": 49.0})
    check("crossing below 50% raises once", len(notes.sent) == 1)
    check("message names the actual figure", "49%" in notes.sent[0][2])

    await svc.evaluate({"soc_pct": 48.0})
    await svc.evaluate({"soc_pct": 47.0})
    check("still-low readings do NOT re-raise inside the ceiling", len(notes.sent) == 1)

    clock.advance(6 * 3600 + 1)
    await svc.evaluate({"soc_pct": 46.0})
    check("re-raises once the 6h re-notify ceiling has passed", len(notes.sent) == 2)

    print("\n=== 3. SoC HYSTERESIS ===")
    svc, notes, clock = fresh()
    await svc.evaluate({"soc_pct": 49.0})
    check("raised", len(notes.sent) == 1)
    await svc.evaluate({"soc_pct": 52.0})  # above floor, inside the margin
    await svc.evaluate({"soc_pct": 49.0})
    check("a wobble across the threshold does not re-raise", len(notes.sent) == 1)
    await svc.evaluate({"soc_pct": 56.0})  # clear of floor + margin -> cleared
    await svc.evaluate({"soc_pct": 49.0})
    check("a genuine recovery then a genuine fall raises again", len(notes.sent) == 2)

    print("\n=== 4. NO SoC AT ALL (no shunt / unsynchronised) ===")
    svc, notes, _ = fresh()
    await svc.evaluate({"soc_pct": None, "voltage": 12.4})
    await svc.evaluate({"voltage": 12.4})
    check("a missing percentage is not treated as zero", notes.sent == [])

    print("\n=== 5. DIVERGENCE MUST BE SUSTAINED ===")
    svc, notes, clock = fresh()
    await svc.evaluate({"voltage": 12.8, "external_voltage": 12.1})  # 0.7V gap, starts the clock
    check("a first divergent reading alone raises nothing", len(notes.sent) == 0)

    clock.advance(120)
    await svc.evaluate({"voltage": 12.8, "external_voltage": 12.1})
    check("two minutes in, still nothing (this is what a kettle looks like)", len(notes.sent) == 0)

    clock.advance(DIVERGENCE_SUSTAIN_SECONDS)
    await svc.evaluate({"voltage": 12.8, "external_voltage": 12.1})
    check("raises once the gap has held past the sustain window", len(notes.sent) == 1)
    check("message names both voltages", "12.80" in notes.sent[0][2] and "12.10" in notes.sent[0][2])

    print("\n=== 6. A LOAD SPIKE RESETS THE CLOCK ===")
    svc, notes, clock = fresh()
    await svc.evaluate({"voltage": 12.8, "external_voltage": 12.1})
    clock.advance(DIVERGENCE_SUSTAIN_SECONDS - 60)
    await svc.evaluate({"voltage": 12.7, "external_voltage": 12.68})  # load off, back together
    clock.advance(120)
    await svc.evaluate({"voltage": 12.8, "external_voltage": 12.1})
    check("recovering mid-window restarts the sustain clock", len(notes.sent) == 0)
    clock.advance(DIVERGENCE_SUSTAIN_SECONDS + 1)
    await svc.evaluate({"voltage": 12.8, "external_voltage": 12.1})
    check("and it raises after a fresh full window", len(notes.sent) == 1)

    print("\n=== 7. EXTERNAL BATTERY UNPLUGGED IS NOT A FAULT ===")
    svc, notes, clock = fresh()
    await svc.evaluate({"voltage": 12.8, "external_voltage": None})
    clock.advance(DIVERGENCE_SUSTAIN_SECONDS + 1)
    await svc.evaluate({"voltage": 12.8, "external_voltage": None})
    check("a removable battery that isn't fitted raises nothing", notes.sent == [])

    print("\n=== 8. BOTH ALARMS ARE INDEPENDENT ===")
    svc, notes, clock = fresh()
    await svc.evaluate({"soc_pct": 45.0, "voltage": 12.2, "external_voltage": 11.4})
    check("SoC raises immediately, divergence is still counting", len(notes.sent) == 1)
    clock.advance(DIVERGENCE_SUSTAIN_SECONDS + 1)
    await svc.evaluate({"soc_pct": 45.0, "voltage": 12.2, "external_voltage": 11.4})
    check("divergence then raises on its own timer, SoC stays silent", len(notes.sent) == 2)
    titles = {n[1] for n in notes.sent}
    check("the two alarms are distinct notifications", len(titles) == 2)

    print("\n=== 9. RE-ENABLING DOES NOT FIRE ON STALE STATE ===")
    alarms = {"battery_enabled": True, "soc_floor_pct": 50.0, "divergence_volts": 0.4, "renotify_hours": 6, "ntfy_topic": ""}
    notes = FakeNotifications()
    clock = FakeClock()
    svc = BatteryAlarmService(None, notes, FakeConfig(alarms), now=clock)
    await svc.evaluate({"soc_pct": 45.0})
    check("raised while enabled", len(notes.sent) == 1)
    alarms["battery_enabled"] = False
    await svc.evaluate({"soc_pct": 45.0})
    alarms["battery_enabled"] = True
    await svc.evaluate({"soc_pct": 45.0})
    check("re-enabling raises fresh rather than being muted by the old ceiling", len(notes.sent) == 2)

    print("\n=== 10. ntfy FAILURE NEVER BREAKS THE IN-APP ALERT ===")
    svc, notes, _ = fresh(ntfy_topic="vanos-test", ntfy_server="http://127.0.0.1:1")  # nothing listening
    await svc.evaluate({"soc_pct": 40.0})
    check("in-app notification still delivered when the push fails", len(notes.sent) == 1)

    print()
    if failures:
        print(f"{len(failures)} FAILURE(S):")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print("All battery alarm tests passed.")


if __name__ == "__main__":
    asyncio.run(main())
