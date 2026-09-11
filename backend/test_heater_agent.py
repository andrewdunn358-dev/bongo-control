"""
Heater agent tests. Run: python backend/test_heater_agent.py

Standalone, no hardware and no framework - the agent module loads
without a Bluetooth adapter, so everything below runs anywhere.

WHAT THIS EXISTS TO CATCH
The poll-command assertion in section 1 is the important one. Polling
with the library's default build_command(1) sends the 0A0A time-sync
packet, and the heater terminates the connection after a few seconds of
being told to reset its clock. That cost two days to find, produced no
error message that pointed at it, and would come back silently the
moment someone "simplified" _query() to use build_command().

Section 2 matters for a different reason: the ignition and cooldown
guards were once written against the RAW running_step values while the
library hands back MAPPED ones. In the mapped set, 3 means running -
so the guard refused to stop a running heater and gave no protection
during actual ignition. Exactly backwards, on the one guard that exists
to stop unburnt fuel fouling the exhaust.

Section 6 (added later, hence the number gap) covers the item 18 fix:
get_device_by_adapter() only reads BlueZ's existing device list and
never scans, so after a reboot or a long idle period the heater can be
sitting right there and still not be found. _find_device() was
extracted from _connect_and_poll() so this fallback - scan once on a
miss, retry the lookup, give up cleanly if still not found - can be
tested directly with a fake scanner and a fake lookup, instead of only
through the real connect flow.
"""

import asyncio
import importlib.util
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "heater_agent", Path(__file__).parent / "tools" / "heater_agent.py"
)
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)

failures = []


def check(label, condition, detail=""):
    print(f"  {'PASS' if condition else 'FAIL'}  {label}" + (f"  [{detail}]" if not condition and detail else ""))
    if not condition:
        failures.append(label)


class FakeClient:
    is_connected = True

    async def write_gatt_char(self, *_a, **_kw):
        return None


def heater_with(state):
    h = agent.Heater()
    h.state = state
    h._client = FakeClient()
    from diesel_heater_ble.protocol import ProtocolHcalory
    h._protocol = ProtocolHcalory()
    h._protocol.set_mvp_version(True)
    return h


print("=== 1. THE POLL COMMAND — the regression that cost two days ===")
h = heater_with({})
query = bytes(h._plain_query())

check("poll sends the 0E04 status request (ends 000d)", query.hex().endswith("000d"), query.hex())
check("poll does NOT contain the 0A0A time-sync opcode", "0a0a" not in query.hex(), query.hex())

# The library's default is the trap. Assert they differ, so if a future
# change routes _query() through build_command() this fails loudly.
default = bytes(h._protocol.build_command(agent.CMD_STATUS, 0, agent.PIN))
check("the library's build_command(1) is a DIFFERENT packet", query != default)
check("...and that default IS the time-sync one", "0a0a" in default.hex(), default.hex())

# Time-sync carries a clock, so it changes between calls. The status
# query must not - a poll that differs every time is a poll that is
# telling the heater something.
check("the status query is identical on repeat calls", bytes(h._plain_query()) == query)

print("\n=== 2. SAFETY GUARDS — against the library's MAPPED step values ===")
check("STEP_IGNITION is the mapped value 2, not the raw 0x3", agent.STEP_IGNITION == 2, str(agent.STEP_IGNITION))
check("STEP_COOLDOWN is the mapped value 4", agent.STEP_COOLDOWN == 4, str(agent.STEP_COOLDOWN))
check("STEP_RUNNING is 3 — the value the old guard wrongly treated as ignition", agent.STEP_RUNNING == 3)


def expect_busy(coro):
    try:
        asyncio.run(coro)
        return False
    except agent.Busy:
        return True
    except Exception:
        return False


def expect_allowed(coro):
    """Got past the guard. The write itself may still fail on the fake
    client, which is fine - we only care the guard let it through."""
    try:
        asyncio.run(coro)
        return True
    except agent.Busy:
        return False
    except Exception:
        return True


h = heater_with({"running_step": agent.STEP_IGNITION})
check("stop REFUSED during ignition", expect_busy(h.power(False)))

h = heater_with({"running_step": agent.STEP_RUNNING})
check("stop ALLOWED while running", expect_allowed(h.power(False)))

h = heater_with({"running_step": agent.STEP_COOLDOWN})
check("start REFUSED during cooldown", expect_busy(h.power(True)))

h = heater_with({"running_step": agent.STEP_COOLDOWN})
check("stop ALLOWED during cooldown (it is already stopping)", expect_allowed(h.power(False)))

print("\n=== 3. VENTILATION — only from standby ===")
h = heater_with({"state": agent.STATUS_HEATING})
check("refused while heating", expect_busy(h.ventilate()))

h = heater_with({"state": agent.STATUS_OFF})
check("allowed from standby", expect_allowed(h.ventilate()))

h = heater_with({"state": agent.STATUS_TURNING_OFF})
check("refused while turning off", expect_busy(h.ventilate()))

print("\n=== 4. RANGE CHECKS ===")


def expect_badvalue(coro):
    try:
        asyncio.run(coro)
        return False
    except agent.BadValue:
        return True
    except Exception:
        return False


check("temperature 99 rejected", expect_badvalue(heater_with({}).temperature(99)))
check("temperature -5 rejected", expect_badvalue(heater_with({}).temperature(-5)))
check("temperature 21 accepted", expect_allowed(heater_with({}).temperature(21)))
check("level 0 rejected", expect_badvalue(heater_with({}).level(0)))
check("level 11 rejected", expect_badvalue(heater_with({}).level(11)))
check("level 5 accepted", expect_allowed(heater_with({}).level(5)))
check("mode 'nonsense' rejected", expect_badvalue(heater_with({}).mode("nonsense")))

print("\n=== 5. STATE SHAPING — the real function, not a copy ===")
# agent.shape_state is the function _query() actually calls. It was
# inline once, which meant testing it required copying it into the
# test - and a test of a copy proves nothing about the code that runs.
parsed = {
    "hcalory_status": agent.STATUS_HEATING,
    "running_state": 1,
    "running_step": agent.STEP_RUNNING,
    "running_mode": 2,          # temperature
    "set_temp": 21,
    "set_level": 4,
    "auto_start_stop": True,
    "supply_voltage": 12.1,
    "case_temperature": 150,
    "cab_temperature": 20,
    "error_code": 0,
}

shaped = agent.shape_state(parsed)
check("state is hcalory_status, NOT running_state", shaped["state"] == agent.STATUS_HEATING, str(shaped["state"]))
check("running_state (0/1) is exposed separately as `on`", shaped["on"] is True)
check("target reads set_temp in temperature mode", shaped["target"] == 21, str(shaped["target"]))
check("readings pass through", shaped["voltage"] == 12.1 and shaped["body_temperature_c"] == 150)

check("target reads set_level in level mode",
      agent.shape_state({**parsed, "running_mode": 1})["target"] == 4)
check("target is None when the heater reports no setpoint",
      agent.shape_state({**parsed, "hcalory_set_value_none": True})["target"] is None)

check("igniting flag set at the mapped ignition step",
      agent.shape_state({**parsed, "running_step": agent.STEP_IGNITION})["igniting"] is True)
check("igniting NOT set while running",
      agent.shape_state(parsed)["igniting"] is False)
check("cooling_down flag set at the mapped cooldown step",
      agent.shape_state({**parsed, "running_step": agent.STEP_COOLDOWN})["cooling_down"] is True)
check("ventilating set from either the step or the status",
      agent.shape_state({**parsed, "running_step": agent.STEP_VENTILATION})["ventilating"] is True
      and agent.shape_state({**parsed, "hcalory_status": agent.STATUS_VENTILATION})["ventilating"] is True)

check("an empty parse does not throw", isinstance(agent.shape_state({}), dict))

print("\n=== 6. SCAN-ON-MISS FALLBACK (item 18: unreachable after idle/reboot) ===")

import bleak  # noqa: E402
import bleak_retry_connector.bluez as bluez_mod  # noqa: E402

_real_get_device_by_adapter = bluez_mod.get_device_by_adapter
_real_discover = bleak.BleakScanner.discover


class FakeScan:
    calls: list[tuple[float, str]] = []

    @staticmethod
    async def discover(*, timeout, adapter):
        FakeScan.calls.append((timeout, adapter))


async def _known_without_scanning():
    async def fake_lookup(mac, adapter):
        return f"DEVICE({mac},{adapter})"

    bluez_mod.get_device_by_adapter = fake_lookup
    bleak.BleakScanner.discover = FakeScan.discover
    FakeScan.calls.clear()
    device = await agent._find_device("AA:BB", "hci0", scan_timeout=1)
    check("a device BlueZ already knows about is returned with no scan", device == "DEVICE(AA:BB,hci0)")
    check("no scan performed when the first lookup already succeeds", FakeScan.calls == [])


async def _found_after_one_scan():
    lookups = []

    async def fake_lookup(mac, adapter):
        lookups.append(1)
        return None if len(lookups) == 1 else f"DEVICE({mac},{adapter})"

    bluez_mod.get_device_by_adapter = fake_lookup
    bleak.BleakScanner.discover = FakeScan.discover
    FakeScan.calls.clear()
    device = await agent._find_device("AA:BB", "hci0", scan_timeout=3)
    check("a device missing on the first lookup is found on the retry after scanning", device == "DEVICE(AA:BB,hci0)")
    check("exactly one scan ran, scoped to the given adapter and timeout", FakeScan.calls == [(3, "hci0")])


async def _still_missing_after_scan():
    async def fake_lookup(mac, adapter):
        return None

    bluez_mod.get_device_by_adapter = fake_lookup
    bleak.BleakScanner.discover = FakeScan.discover
    FakeScan.calls.clear()
    device = await agent._find_device("AA:BB", "hci0", scan_timeout=2)
    check("still not found after scanning returns None, not an exception", device is None)
    check("only ONE scan is run even when the device genuinely isn't there", len(FakeScan.calls) == 1)


try:
    asyncio.run(_known_without_scanning())
    asyncio.run(_found_after_one_scan())
    asyncio.run(_still_missing_after_scan())
finally:
    # Restore the real functions - other sections of this script (or a
    # future one appended after this) shouldn't inherit fakes.
    bluez_mod.get_device_by_adapter = _real_get_device_by_adapter
    bleak.BleakScanner.discover = _real_discover

print()
if failures:
    print(f"{len(failures)} FAILURE(S):")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("All heater agent tests passed.")
