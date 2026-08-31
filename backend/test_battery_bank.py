"""
Battery bank capacity tests. Run: python backend/test_battery_bank.py

The whole point of this service is that a runtime estimate more than
doubles when the external battery is paralleled on - so the thing worth
testing is that it says "connected" when and only when the battery is
actually contributing, not merely present.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from app.services.battery_bank_service import BatteryBankService  # noqa: E402

failures = []


def check(label, condition, detail=""):
    print(f"  {'PASS' if condition else 'FAIL'}  {label}{f' [{detail}]' if detail and not condition else ''}")
    if not condition:
        failures.append(label)


class FakeConfig:
    def __init__(self, sections):
        self._sections = sections

    def get(self, section, default=None):
        return self._sections.get(section, default if default is not None else {})


def fresh(leisure=120.0, external=130.0, divergence=0.4):
    cfg = FakeConfig({
        "battery_bank": {"leisure_ah": leisure, "external_ah": external},
        "alarms": {"divergence_volts": divergence},
    })
    return BatteryBankService(telemetry_service=None, configuration_service=cfg)


def main():
    print("=== 1. EXTERNAL NOT FITTED ===")
    svc = fresh()
    c = svc.capacity({"voltage": 12.7, "external_voltage": None, "current_a": -2.0})
    check("falls back to the leisure battery alone", c["amp_hours"] == 120.0, str(c["amp_hours"]))
    check("not reported as connected", c["external_connected"] is False)
    check("watt-hours track the amp-hours", abs(c["watt_hours"] - 120 * 12.8) < 0.1, str(c["watt_hours"]))

    print("\n=== 2. EXTERNAL CONNECTED AND CARRYING CURRENT ===")
    c = svc.capacity({"voltage": 12.62, "external_voltage": 12.60, "current_a": -8.0})
    check("pools both batteries", c["amp_hours"] == 250.0, str(c["amp_hours"]))
    check("reported as connected", c["external_connected"] is True)
    check("confident, because current is flowing", c["confident"] is True)
    check("watt-hours reflect the combined bank", abs(c["watt_hours"] - 250 * 12.8) < 0.1, str(c["watt_hours"]))

    print("\n=== 3. PRESENT BUT NOT CONNECTED — THE ONE THAT MATTERS ===")
    # The sense wire still reads a healthy voltage off a battery whose
    # Anderson connector has backed out or whose breaker has tripped.
    # Counting its capacity here would promise runtime that doesn't exist.
    c = svc.capacity({"voltage": 12.75, "external_voltage": 12.10, "current_a": -8.0})
    check("a diverging battery is NOT counted", c["amp_hours"] == 120.0, str(c["amp_hours"]))
    check("not reported as connected", c["external_connected"] is False)
    check("reason names the gap", "0.65V" in c["reason"], c["reason"])

    print("\n=== 4. AT REST, THE ANSWER IS THE SAME BUT LESS CERTAIN ===")
    c = svc.capacity({"voltage": 12.70, "external_voltage": 12.70, "current_a": 0.0})
    check("still counts both", c["amp_hours"] == 250.0, str(c["amp_hours"]))
    check("but flags that it can't confirm", c["confident"] is False)
    check("reason says why", "at rest" in c["reason"], c["reason"])

    c = svc.capacity({"voltage": 12.70, "external_voltage": 12.70, "current_a": 12.0})
    check("charging counts as current too, not just discharge", c["confident"] is True)

    print("\n=== 5. THE THRESHOLD IS SHARED WITH THE DIVERGENCE ALARM ===")
    # If these ever drifted apart, the app could alarm about a
    # disconnected battery while still counting its capacity.
    tight = fresh(divergence=0.1)
    payload = {"voltage": 12.75, "external_voltage": 12.55, "current_a": -5.0}
    check("a 0.2V gap counts as connected at the 0.4V default", fresh().capacity(payload)["external_connected"] is True)
    check("and as disconnected at a 0.1V threshold", tight.capacity(payload)["external_connected"] is False)

    print("\n=== 6. CAPACITIES COME FROM CONFIG ===")
    c = fresh(leisure=100.0, external=200.0).capacity({"voltage": 12.6, "external_voltage": 12.6, "current_a": -5.0})
    check("configured values are used, not the defaults", c["amp_hours"] == 300.0, str(c["amp_hours"]))

    print("\n=== 7. NO SHUNT AT ALL ===")
    c = svc.capacity({})
    check("empty payload gives the leisure battery", c["amp_hours"] == 120.0, str(c["amp_hours"]))
    check("does not claim a connection", c["external_connected"] is False)

    print("\n=== 8. GARBAGE VALUES DON'T PRODUCE A BIGGER BANK ===")
    for bad in ("nonsense", True, [1, 2]):
        c = svc.capacity({"voltage": 12.7, "external_voltage": bad, "current_a": -5.0})
        check(f"external_voltage={bad!r} is not treated as a match", c["amp_hours"] == 120.0, str(c["amp_hours"]))

    print()
    if failures:
        print(f"{len(failures)} FAILURE(S):")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print("All battery bank tests passed.")


if __name__ == "__main__":
    main()
