# Hcalory heater BLE plugin

_9 Sep 2026. Reads the new diesel heater's live state into VanOS._

## What it does

Publishes body temperature, cabin temperature, supply voltage, run
state, mode and power setting to a new `HEATING` telemetry domain. The
same figures the phone app shows.

**Read-only, deliberately.** The protocol supports start/stop and the
command bytes are in the plugin, unused. Turning a combustion heater on
from a web UI — potentially from outside the van over the Cloudflare
tunnel — is a different decision from switching a light and deserves its
own interlocks, not arriving as a side effect of adding a sensor.

## Why it is shaped unlike the Victron plugins

The Victron devices **broadcast**. Those plugins share one passive
scanner and never connect (see `ble_scanner.py`).

This heater tells you nothing unless asked. You must open a GATT
connection, subscribe to notifications on the read characteristic, then
**write a "pump data" command** before it sends anything. The official
app does this once a second. So this plugin holds a connection and
polls.

Two consequences:

1. **Only one thing can connect at a time.** While VanOS holds the
   connection the phone app cannot, and vice versa. That is the heater's
   behaviour, not a bug — and it is the first thing to check when either
   stops working. It is also the likeliest reason the first Pi scan for
   the heater found nothing.
2. An active GATT connection alongside BlueZ's discovery scan (which the
   Victron plugins keep running) is less reliable on a Pi than either
   alone. Hence retry with backoff rather than assuming the link holds.

## Protocol

From `evanfoster/hcalory-control` (LGPL-3.0) and `mSoftMS/AirHeater-BLE`
(MIT), both of which reverse-engineered the official app.

- Write characteristic `0000fff2-…`, read `0000fff1-…`
- Command = 20-byte header `000200010001000e040000090000000000000000`
  plus a two-byte opcode. Pump data is `000d`.
- Response, 39 bytes: `[20]` state, `[21]` mode, `[22]` setting,
  `[25]` voltage in tenths, `[27:29]` body temp in tenths big-endian,
  `[30:32]` ambient temp in tenths.

Reimplemented rather than taken as a dependency: upstream pulls in
`datastruct` to parse one 39-byte frame, and `struct` is in the standard
library. On a Pi 2B that is a poor trade.

**One deliberate difference from upstream:** it uses integer division,
so 12.4 V arrives as 12 and 150.7 °C as 150. The raw values are tenths
and the app shows the decimal, so this keeps it.

## Setup

1. **Find the MAC.** Close the Hcalory app completely and turn the
   phone's Bluetooth off, or the heater will not advertise. Then on the
   Pi:

       timeout 20 bluetoothctl scan on | grep -iE "hcalory|airheater|Name:"

   It advertises as `HCALORY`, `AirHeater` or `TY`.

2. Set `hcalory_heater.mac` in config and `enabled: true`.

Note for a future scan: the unnamed devices with manufacturer ID
`0x02e1` in a BlueZ scan are the **Victron** MPPT and SmartShunt, not
phones. On 9 Sep those appeared at −44 and −73 dBm, which proves the
Pi's radio hears the van fine.

## Error codes, for reference

From AirHeater-BLE, and they match what this van produced:

| Code | Meaning |
|---|---|
| E-01 | General |
| E-02 | Low / high voltage |
| E-03 | Glow plug |
| E-04 | Fuel pump |
| E-05 | Overheat |
| E-06 | Fan |
| E-07 | Communication |
| E-08 | No fuel / flame-out |
| E-09 | Sensor |
| E-10 | Ignition failure |

E-07 appeared on this van when the controller wire fell out during the
heater swap, which matches exactly.

## The uninterruptible flag

States 65/67/69 (cooldown) and 128/129/131/135 (ignition and heating)
are flagged `uninterruptible`. Cutting power during those is what leaves
unburnt fuel in the exhaust — on this van that fouled the old heater
badly enough that the replacement had to burn through the residue before
it would light. Anything that later adds control must respect this flag.

## Status

Parser tested — 39 assertions, cross-checked against a real reading
taken from the phone app (150.0 °C body, 22.0 °C ambient, 12.0 V,
running, thermostat, set 21). **The BLE connection itself is untested**;
it cannot be exercised without the heater. Expect one round of "what
does this show" against the real device.
