# Victron SmartSolar MPPT — Bluetooth Integration

This is the first real hardware plugin in Bongo Control. Read this
before enabling it.

## How it actually works

Victron doesn't publish an official API for third-party BLE integration.
What exists instead, and what this plugin uses, is **"Instant Readout"**
— a passive BLE advertisement your MPPT broadcasts constantly, containing
encrypted manufacturer data. No pairing, no connection, just listening.
This is the same approach used by Home Assistant's own Victron
integration, ESPHome, and every other serious open-source Victron BLE
project — decryption goes through the [`victron-ble`](https://github.com/keshavdv/victron-ble)
library rather than us reimplementing AES-CTR decryption ourselves.

```
Victron MPPT (broadcasting encrypted BLE advertisements)
        │
        ▼
VictronMPPTPlugin (Bleak scans, victron-ble decrypts)
        │
        ▼
TelemetryService.publish()
        │
        ▼
Telemetry Bus
        │
        ▼
WebSocket → Frontend (unchanged — same domains, same shapes it already knew)
```

## Getting your encryption key (you have to do this — nothing else can)

Each Victron device has its own per-unit AES key used to encrypt its
advertisements. There's no way to derive or guess it — it has to come
from the VictronConnect app, once, per device:

1. Install VictronConnect (phone or desktop) and pair with your MPPT at
   least once over Bluetooth, the normal way.
2. Open the device in the app → gear icon (Settings) → **Product Info**.
3. Scroll to **Instant Readout via Bluetooth**, enable it if it isn't
   already.
4. The 32-character hex encryption key is shown there. On some
   platforms (notably Mac) it's easier to pull it from VictronConnect's
   local SQLite database instead — see the
   [victron-ble README](https://github.com/keshavdv/victron-ble#readme)
   for the exact steps for your OS.

Enter this key in **Settings → Hardware** in Bongo Control, save, then
enable the plugin in **Settings → Plugins**.

The MAC address field is optional — leave it blank and the plugin uses
the first Victron solar-charger advertisement it decrypts successfully.
Only set it if you have multiple Victron devices nearby and need to
pin to a specific one.

## What telemetry is actually available (important — read this)

The original plan for this milestone assumed several fields that
**Instant Readout does not actually provide** for a solar charger. This
was checked against the real `victron-ble` parser source and its own
test vectors (real captured bytes from an actual MPPT unit), not
assumed:

| Requested | Available? | Notes |
|---|---|---|
| Battery Voltage | ✅ Yes | |
| Battery Current | ✅ Yes | The MPPT's own charging current — not total battery current (that needs a shunt) |
| Battery Power | ✅ Yes (derived) | We compute voltage × current ourselves |
| Solar Power | ✅ Yes | |
| PV Voltage | ❌ No | Not part of the Instant Readout payload — only combined solar power is |
| PV Current | ❌ No | Same as above |
| Charger State | ✅ Yes | Off/Bulk/Absorption/Float/etc. |
| Charge Stage | ✅ Yes | This is the *same field* as Charger State, not a separate one |
| Daily Yield | ✅ Yes | As `yield_today_wh` |
| Maximum Power Today | ✅ Yes (derived) | Instant Readout doesn't report this directly — we track a running max ourselves from live readings, reset at midnight |
| Error State | ✅ Yes | Full Victron MPPT error code list, e.g. "input_voltage", "over_current" |
| Firmware Version | ❌ No | Not part of Instant Readout at all. Getting it requires Victron's separate, undocumented, paired GATT protocol — far more fragile, and not what any known open-source project reliably does. Not implemented. |
| Device Name | ⚠️ Partial | Available as the BLE advertised name (captured automatically), not from the encrypted payload |
| **State of Charge** | ❌ **No** | **An MPPT cannot measure this at all** — it only knows battery voltage and its own charging current, not accumulated charge. This needs a SmartShunt (coulomb counting), which is a separate future milestone. Battery voltage is reported; `soc_pct` is `null` until a shunt exists — the frontend shows "—" for this rather than a fabricated number. |

If the missing fields matter to you, the options are: wait for
Victron to publish something better (unlikely, per their own forum
responses), or pursue the undocumented paired GATT approach — which is
a materially different, far more fragile effort, not a small addition
to this plugin.

## Auto-reconnect

BLE advertisements aren't a persistent connection you can "drop" —
there's nothing to reconnect in the TCP sense. What this plugin does
instead: a supervisor loop watches for the advertisement stream going
silent (no packet for 60 seconds — device out of range, adapter
hiccup, BlueZ restart) and restarts the scan when that happens, with
backoff on repeated failures. This is the correct behavior for this
transport, not a simplification.

## Switching between Simulation and Victron

No code changes needed — this is exactly what the Plugin Manager's
enable/disable (Sprint 4) was built for:

- **Settings → Plugins**: disable Simulation, enable Victron SmartSolar
  MPPT (after configuring the key in Settings → Hardware).
- Both plugins are always discovered and registered; only one needs to
  be *enabled* at a time. You can technically run both simultaneously
  too — they publish onto the same domains, so whichever publishes most
  recently is what the dashboard shows.

## Docker / Bluetooth requirement — NOT verified against real hardware

`docker-compose.yml`'s backend service now uses `network_mode: host`
and mounts `/var/run/dbus`, which is the standard, documented way to
give a container access to the host's BlueZ/D-Bus stack for BLE. This
is the same approach other Victron-BLE-in-Docker projects use.

**I have not been able to test this against real hardware** — this
sandbox has no Bluetooth adapter at all. What I *have* verified:

- The plugin imports and runs cleanly.
- Enabling it with no encryption key set produces a clear error, not a
  crash.
- Enabling it with a key set, in an environment with no real Bluetooth
  adapter (this sandbox), correctly fails to start the BLE scan with a
  clear error — proving the failure path is handled gracefully, not
  that it connects successfully.
- The decryption/field-mapping logic is correct against `victron-ble`'s
  own real captured-hardware test vectors (an actual MPPT 75/15's
  advertisement bytes) — battery voltage, current, charge state, solar
  power, and yield all decoded and mapped correctly by this plugin's
  code specifically.

**What only your Pi can verify**: that `network_mode: host` +
the D-Bus mount actually lets the container see your Bluetooth
dongle, and that the plugin actually receives and decrypts real
advertisements from your specific MPPT. If it doesn't work:

1. Check `bluetoothctl` on the Pi itself (outside Docker) can see the
   MPPT advertising — confirms the dongle/BlueZ setup is fine
   independent of Docker.
2. Check the backend container's logs (`docker compose logs backend`)
   for the specific error — the plugin reports errors clearly via
   `last_error`, visible on Settings → Plugins too.
3. If host networking + D-Bus mount genuinely doesn't work on your
   DSM/Pi setup, the fallback is running the backend directly on the
   Pi (outside Docker) where it has native Bluetooth access, with just
   the frontend containerized. This is a bigger change and hasn't been
   built, but is a known escape hatch.

Please test on your actual hardware and report back what happens
(errors and all) — that's the only way this gets fully verified.
