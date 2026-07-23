import asyncio
import sys
from unittest.mock import MagicMock

sys.modules["gpiozero"] = MagicMock()

from app.services.roof_service import RoofService, RoofUnavailableError, MAX_RUN_SECONDS  # noqa: E402


class FakeRelays:
    """Records every set() call so we can assert on relay state over time."""

    def __init__(self):
        self.state = {2: False, 3: False}
        self.calls = []
        self.available = True

    def is_available(self):
        return self.available

    def set(self, channel, on):
        self.state[channel] = on
        self.calls.append((channel, on))

    def both_off(self):
        return not any(self.state.values())

    def only(self, channel):
        return self.state[channel] and not any(v for k, v in self.state.items() if k != channel)


def fresh():
    relays = FakeRelays()
    svc = RoofService(relays)
    svc.configure({"enabled": True, "up_channel": 2, "down_channel": 3})
    return relays, svc


async def main():
    print("=== 1. DISABLED BY DEFAULT (unconfigured install) ===")
    relays = FakeRelays()
    svc = RoofService(relays)
    svc.configure({})
    try:
        await svc.hold("up")
        print("  FAIL - moved while unconfigured")
    except RoofUnavailableError as e:
        print(f"  refused: {e}")
    assert relays.both_off()
    print("  -> a fresh install cannot drive the motor\n")

    print("=== 2. ENABLED BUT NO CHANNELS ASSIGNED ===")
    relays = FakeRelays()
    svc = RoofService(relays)
    svc.configure({"enabled": True})
    try:
        await svc.hold("up")
        print("  FAIL - moved without channels")
    except RoofUnavailableError:
        print("  refused - enabled alone is not enough\n")
    assert relays.both_off()

    print("=== 3. NORMAL MOVEMENT ===")
    relays, svc = fresh()
    await svc.hold("up")
    assert relays.only(2), f"expected only ch2 on, got {relays.state}"
    print(f"  holding up -> channel 2 on, channel 3 off: {relays.state}")
    st = svc.status()
    print(f"  status: moving={st['moving']}  position_is_unknown={st['position_is_unknown']}")
    assert st["position_is_unknown"] is True

    print("\n=== 4. RELEASE STOPS IMMEDIATELY ===")
    await svc.release()
    assert relays.both_off(), relays.state
    print(f"  after release: {relays.state}  reason={svc.status()['last_stopped_reason']}\n")

    print("=== 5. WATCHDOG - the critical one ===")
    print("  Simulating a dropped connection: hold once, then go silent.")
    relays, svc = fresh()
    await svc.hold("up")
    assert relays.only(2)
    print(f"  t=0.0s  holding, channel 2 on")
    await asyncio.sleep(1.0)
    print(f"  t=1.0s  still within watchdog window, moving={svc.status()['moving']}")
    await asyncio.sleep(1.2)
    st = svc.status()
    print(f"  t=2.2s  moving={st['moving']}  reason={st['last_stopped_reason']}")
    assert relays.both_off(), "WATCHDOG FAILED - motor still energised after silence"
    print("  -> dropped connection stopped the motor\n")

    print("=== 6. NEVER BOTH CHANNELS AT ONCE ===")
    relays, svc = fresh()
    await svc.hold("up")
    try:
        await svc.hold("down")
    except RoofUnavailableError as e:
        print(f"  reversing mid-move refused: {e}")
    both_on_ever = False
    up = down = False
    for ch, on in relays.calls:
        if ch == 2:
            up = on
        if ch == 3:
            down = on
        if up and down:
            both_on_ever = True
    assert not both_on_ever, "BOTH CHANNELS WERE ENERGISED SIMULTANEOUSLY"
    print("  -> replayed every relay call: both were never on together\n")
    await svc.release()

    print("=== 7. STOP DE-ENERGISES BOTH CHANNELS ===")
    relays, svc = fresh()
    await svc.hold("up")
    relays.state[3] = True  # simulate ch3 stuck on from anything else
    await svc.release()
    assert relays.both_off(), relays.state
    print(f"  a stray energised channel was also cleared: {relays.state}\n")

    print("=== 8. SHUTDOWN STOPS THE MOTOR ===")
    relays, svc = fresh()
    await svc.hold("down")
    assert relays.only(3)
    await svc.stop_all()
    assert relays.both_off()
    print("  stop_all() de-energised everything\n")

    print("=== 9. MAX RUN CEILING ===")
    print(f"  MAX_RUN_SECONDS = {MAX_RUN_SECONDS}")
    relays, svc = fresh()
    await svc.hold("up")
    svc._started_at -= MAX_RUN_SECONDS + 1  # pretend it has been running too long
    try:
        await svc.hold("up")
        print("  FAIL - kept going past the ceiling")
    except RoofUnavailableError as e:
        print(f"  refused: {e}")
    assert relays.both_off(), "motor still running past max time"
    print("  -> a stuck button cannot run the motor indefinitely\n")

    print("ALL ROOF SAFETY TESTS PASSED")


asyncio.run(main())
