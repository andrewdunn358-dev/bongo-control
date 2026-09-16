#!/usr/bin/env python3
"""
HARDWARE CONTRACT GUARD

Fails the build if anything that maps to real 12V hardware, or to a
safety behaviour, has been changed.

WHY THIS EXISTS
This repo drives physical circuits in a campervan: relays on 30A fused
loads, a pop-top roof with two motors and no position sensor, and a
diesel heater. More than one agent contributes to it, and a plausible-
looking edit to a constant here does not fail a type check, does not
fail a build, and does not look wrong in review - it just silently
drives the wrong circuit, or removes the thing that stops a motor.

So the frozen values are asserted here, by value, and the build fails
if they move.

WHEN THIS FAILS LEGITIMATELY
If the physical van genuinely changes - a relay is rewired, the roof
timing is deliberately retuned - update EXPECTED below in the same
commit as the code change, and say why in the commit message. That is
the point: the change becomes deliberate and visible rather than
accidental and silent.

Run: python3 tools/check_hardware_contract.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ── The frozen contract ────────────────────────────────────────────
# Every value verified against the physical van. See the audit in
# docs/FRONTEND-CONTRACT.md and claude_hardware-switch-panel.md.

EXPECTED_GPIO = {
    1: 17,   # TV        (30A fused. NOTE: channel has a hardware fault)
    2: 27,   # Lights    (inverted: true)
    3: 22,   # Amp       (confirmed by physical test)
    4: 23,   # Spare     (in_use: false)
    5: 12,   # Roof isolate A
    6: 13,   # Roof isolate B
    7: 16,   # Roof up
    8: 26,   # Roof down (GPIO 25 / pin 22 is DEAD on this board)
}

# Board is HIGH-trigger. Docs claiming active_high=false are stale.
EXPECTED_ACTIVE_HIGH = True

# Drive LOW at boot = relays de-energised. `dh` on this HIGH-trigger
# board would energise every circuit for the whole boot window.
EXPECTED_BOOT_GUARD = "gpio=17,27,22,23,16,26,12,13=op,dl"

# Roof has NO position sensor and NO limit switches. These three are
# the only things that stop the motors.
EXPECTED_ROOF = {
    "WATCHDOG_SECONDS": "1.5",   # relay drops if hold requests stop
    "MAX_RUN_SECONDS": "30.0",   # absolute ceiling on one movement
}

failures: list[str] = []


def read(rel: str) -> str:
    p = ROOT / rel
    if not p.is_file():
        failures.append(f"MISSING FILE: {rel}")
        return ""
    return p.read_text()


def check_gpio_map() -> None:
    src = read("backend/app/services/configuration_service.py")
    if not src:
        return
    found = {int(cid): int(gpio) for cid, gpio in re.findall(r'"id":\s*(\d+),\s*"gpio":\s*(\d+)', src)}
    for cid, gpio in EXPECTED_GPIO.items():
        if cid not in found:
            failures.append(f"GPIO: relay channel {cid} is missing from DEFAULT_CONFIG")
        elif found[cid] != gpio:
            failures.append(
                f"GPIO CHANGED: channel {cid} was GPIO {gpio}, is now GPIO {found[cid]}. "
                "This drives a different physical circuit."
            )
    for cid in found:
        if cid not in EXPECTED_GPIO:
            failures.append(f"GPIO: unexpected relay channel {cid} (GPIO {found[cid]}) - update EXPECTED_GPIO if deliberate")


def check_polarity() -> None:
    src = read("backend/app/services/relay_service.py")
    if not src:
        return
    m = re.search(r"_active_high\s*=\s*(True|False)", src)
    if not m:
        failures.append("POLARITY: could not find _active_high in relay_service.py")
    elif (m.group(1) == "True") != EXPECTED_ACTIVE_HIGH:
        failures.append(
            f"POLARITY INVERTED: _active_high is now {m.group(1)}. "
            "Every relay would switch the wrong way round."
        )


def check_boot_guard() -> None:
    for rel in ("backend/app/services/relay_service.py", "backend/app/services/configuration_service.py"):
        src = read(rel)
        if src and EXPECTED_BOOT_GUARD not in src:
            failures.append(
                f"BOOT GUARD: {rel} no longer documents '{EXPECTED_BOOT_GUARD}'. "
                "Without it the relays energise for the entire boot window."
            )


def check_roof_safety() -> None:
    src = read("backend/app/services/roof_service.py")
    if not src:
        return
    for name, expected in EXPECTED_ROOF.items():
        m = re.search(rf"{name}\s*=\s*([0-9.]+)", src)
        if not m:
            failures.append(f"ROOF SAFETY: {name} not found - it is one of only three things that stop the motors")
        elif m.group(1) != expected:
            failures.append(f"ROOF SAFETY CHANGED: {name} was {expected}, is now {m.group(1)}")

    # The roof must never claim a position it cannot sense.
    if "position_is_unknown" not in src:
        failures.append("ROOF HONESTY: position_is_unknown has gone from roof_service.py - there is no position sensor")


def check_roof_excluded_from_relay_api() -> None:
    """Roof channels must not be drivable as plain on/off relays: a plain
    toggle has no watchdog, so 'on and forget' would run the motors."""
    src = read("backend/app/api/routes/relays.py")
    if src and "roof" not in src.lower():
        failures.append(
            "ROOF INTERLOCK: relays.py no longer mentions roof. Roof channels must stay "
            "excluded from /relays set|toggle - a plain toggle bypasses the watchdog."
        )


def check_heater_guards() -> None:
    """The three heater guards live in the host agent so they hold
    however the heater is driven. Stopping mid-ignition fouls the
    exhaust with unburnt fuel - it destroyed the previous heater."""
    src = read("backend/tools/heater_agent.py")
    if not src:
        return
    for needle, why in (
        ("STEP_IGNITION", "ignition state constant"),
        ("STEP_COOLDOWN", "cooldown state constant"),
        ("Ventilation only works from standby", "ventilation guard"),
    ):
        if needle not in src:
            failures.append(f"HEATER SAFETY: {why} ({needle}) missing from heater_agent.py")


def main() -> int:
    check_gpio_map()
    check_polarity()
    check_boot_guard()
    check_roof_safety()
    check_roof_excluded_from_relay_api()
    check_heater_guards()

    if failures:
        print("HARDWARE CONTRACT VIOLATION\n")
        for f in failures:
            print(f"  ✗ {f}")
        print(
            "\nThese values map to real 12V circuits and to the only mechanisms that\n"
            "stop a roof motor or a diesel heater. If the physical van has genuinely\n"
            "changed, update EXPECTED in tools/check_hardware_contract.py in the SAME\n"
            "commit and explain why. Otherwise this is a bug - do not merge it."
        )
        return 1

    print("Hardware contract OK - GPIO map, polarity, boot guard, roof watchdog/ceiling,")
    print("roof interlock, position honesty and heater guards all unchanged.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
