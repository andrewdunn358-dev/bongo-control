# Issue draft — diesel-heater-ble

**POSTED 11 Sep 2026:** https://github.com/Spettacolo83/diesel-heater-ble/issues/2

**Repo:** https://github.com/Spettacolo83/diesel-heater-ble/issues
**Title:** `PyPI 0.3.3 predates the MVP1-query default — Hcalory MVP2 heater terminates the connection when polled with `build_command(1)``

---

Thanks for the library — it made an Hcalory MVP2 heater workable for us,
and the protocol notes in the source saved a lot of guessing.

Flagging a gap between the released package and `main`, because it cost
us about two days and the symptom points nowhere near the cause.

## What happens

On an Hcalory MVP2 device (service `BD39`), polling status with
`build_command(1, 0, pin)` using **PyPI 0.3.3** makes the heater
terminate the BLE connection after roughly 6–19 seconds. Reconnect,
same again.

At HCI level (`btmon`) the disconnect is:

```
> HCI Event: Disconnect Complete
        Reason: Remote User Terminated Connection (0x13)
```

The heater is hanging up deliberately. Nothing upstream of that reports
anything useful — `bleak` surfaces it as `failed to discover services,
device disconnected` on the next attempt, which reads like a Bluetooth
or adapter fault. We chased BlueZ versions, service caching, adapter
contention and a second dongle before capturing HCI and finding the
real cause.

## Why

In 0.3.3, `build_command(1, …)` on an MVP2 device returns the `0A0A`
packet — which is the **time-sync** command. Polling once per second
therefore tells the heater to set its clock once per second, and after a
few seconds of that it drops the connection.

`main` already fixes this. `_prefer_mvp1_query` defaults to `True` and
the plain `0E04` status request is used instead:

```python
# Status request - prefer MVP1 query unless explicitly set to use MVP2
# The working Acropolis9064 integration uses MVP1 (0E04) for HBU1S,
# so we default to MVP1 even for bd39 (MVP2) devices.
```

That code is not in 0.3.3 — there is no `prefer_mvp1_query` in the
released package at all.

## The ask

A release containing that change, if there's nothing blocking one.
Anyone starting from `pip install diesel-heater-ble` today gets the
behaviour that drops the connection, with no indication why.

(Noticed `pyproject.toml` on `main` reads `version = "0.2.6"` while PyPI
is at 0.3.3, so the versioning may need a look too — mentioning it in
case it's relevant rather than as a problem in itself.)

## Workaround, for anyone who finds this first

Build the status request directly rather than through `build_command`:

```python
from diesel_heater_ble.const import HCALORY_CMD_POWER, HCALORY_POWER_QUERY

query = protocol._build_hcalory_cmd(
    HCALORY_CMD_POWER,
    bytes([0, 0, 0, 0, 0, 0, 0, 0, HCALORY_POWER_QUERY]),
)
```

Send the `0A0A` time sync **once** on connect, after the password
handshake, then poll with the above. With that change the link holds —
ours has been up continuously since, where before it dropped every
6–19 seconds without fail.

## Environment

- Hcalory 2kW, advertises as `Heater5579`, service `BD39` (MVP2), PIN 0000
- Raspberry Pi 2B, Debian, BlueZ 5.x, `bleak` + `bleak-retry-connector`
- `diesel-heater-ble==0.3.3` from PyPI
- Not Home Assistant — a standalone Python agent, so the transport is
  ours and the library is used for protocol only

Happy to test a release candidate against real hardware if that's useful.
