"""
Hcalory heater frame parser tests. Run: python backend/test_hcalory_parser.py

The parser is the only part of this plugin that can be tested without
the heater in front of you, and it is where a silent bug would hide -
a wrong byte offset produces plausible-looking numbers, not an error.

Frames here are built from the documented layout and cross-checked
against a real reading taken from the phone app on 9 Sep 2026:
body 150.0C, ambient 22.0C, 12.0V, running, thermostat mode, set to 21.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from app.plugins.hcalory_heater.plugin import parse_frame  # noqa: E402

failures = []


def check(label, condition, detail=""):
    print(f"  {'PASS' if condition else 'FAIL'}  {label}{f'  [{detail}]' if not condition and detail else ''}")
    if not condition:
        failures.append(label)


def frame(state=133, mode=1, setting=21, voltage=120, body=1500, ambient=220, length=39):
    """Builds a status frame to the documented layout."""
    data = bytearray(length)
    data[20] = state
    data[21] = mode
    data[22] = setting
    data[23] = 0
    data[25] = voltage
    data[27] = body >> 8
    data[28] = body & 0xFF
    data[30] = ambient >> 8
    data[31] = ambient & 0xFF
    return bytes(data)


print("=== 1. THE REAL READING FROM THE VAN ===")
r = parse_frame(frame())
check("body temperature 150.0C", r["body_temperature_c"] == 150.0, str(r["body_temperature_c"]))
check("ambient temperature 22.0C", r["ambient_temperature_c"] == 22.0, str(r["ambient_temperature_c"]))
check("voltage 12.0V", r["voltage"] == 12.0, str(r["voltage"]))
check("state running", r["state"] == "running", r["state"])
check("mode thermostat", r["mode"] == "thermostat", r["mode"])
check("setting 21", r["setting"] == 21, str(r["setting"]))

print("\n=== 2. TENTHS ARE KEPT, NOT TRUNCATED ===")
# Upstream uses integer division and reports 12.4V as 12. The phone app
# shows the decimal, so throwing it away loses a digit we have.
r = parse_frame(frame(voltage=124, body=1507, ambient=185))
check("12.4V is not truncated to 12", r["voltage"] == 12.4, str(r["voltage"]))
check("150.7C is not truncated to 150", r["body_temperature_c"] == 150.7, str(r["body_temperature_c"]))
check("18.5C is not truncated to 18", r["ambient_temperature_c"] == 18.5, str(r["ambient_temperature_c"]))

print("\n=== 3. TEMPERATURES ARE BIG-ENDIAN TWO-BYTE ===")
# A body temperature above 25.5C needs both bytes. Reading only one
# would wrap silently and look plausible.
r = parse_frame(frame(body=2260))
check("226.0C reads across both bytes", r["body_temperature_c"] == 226.0, str(r["body_temperature_c"]))
r = parse_frame(frame(body=64))
check("6.4C reads correctly in the low byte alone", r["body_temperature_c"] == 6.4, str(r["body_temperature_c"]))

print("\n=== 4. STATES ===")
for code, name in [(0, "off"), (65, "cooldown"), (131, "igniting"), (133, "running"), (135, "heating"), (255, "error")]:
    r = parse_frame(frame(state=code))
    check(f"state {code} is {name}", r["state"] == name, r["state"])

print("\n=== 5. AN UNKNOWN STATE IS REPORTED, NOT GUESSED ===")
# The alternative - mapping it to the nearest known state - would show
# a confident wrong answer for a condition nobody has seen yet.
r = parse_frame(frame(state=200))
check("unknown state keeps its raw code", r["state"] == "unknown (200)", r["state"])
check("and is not treated as running", r["running"] is False)

print("\n=== 6. THE UNINTERRUPTIBLE FLAG ===")
# This is the one that matters operationally: cutting power during
# ignition or cooldown is what leaves unburnt fuel in the exhaust.
for code in (65, 67, 69, 128, 129, 131, 135):
    r = parse_frame(frame(state=code))
    check(f"state {code} is flagged uninterruptible", r["uninterruptible"] is True)
for code in (0, 133):
    r = parse_frame(frame(state=code))
    check(f"state {code} is interruptible", r["uninterruptible"] is False)

print("\n=== 7. ERRORS ===")
r = parse_frame(frame(state=255))
check("state 255 is an error", r["error"] is True)
r = parse_frame(frame(mode=8))
check("mode 8 (ignition failed) is an error", r["error"] is True)
check("and is named, not left as a number", r["mode"] == "ignition_failed", r["mode"])
r = parse_frame(frame())
check("a healthy frame is not an error", r["error"] is False)

print("\n=== 8. SHORT FRAMES RETURN None RATHER THAN THROWING ===")
# Truncated BLE notifications are routine. One should cost a poll, not
# the plugin.
for n in (0, 10, 20, 31):
    check(f"{n}-byte frame returns None", parse_frame(bytes(n)) is None)
check("a 32-byte frame is the minimum accepted", parse_frame(frame(length=32)) is not None)

print()
if failures:
    print(f"{len(failures)} FAILURE(S):")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("All Hcalory parser tests passed.")
