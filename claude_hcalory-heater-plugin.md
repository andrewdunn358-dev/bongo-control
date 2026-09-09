# Hcalory heater — VanOS plugin and Heater screen

_9 Sep 2026. Read AND control the diesel heater from VanOS._

## The heater

- Advertises as **`Heater5579`**, MAC **`20:25:05:19:0D:33`**
- Service **BD39** — Hcalory **MVP2**
- PIN **0000**
- Signal from the Pi: **−23 dBm**, the strongest device in the scan.
  Range was never the problem.

## What took an evening to find

**There are two incompatible Hcalory variants.** The first plugin
implemented MVP1 (service FFF0), from a project written against a W1,
and was simply wrong for this van.

| Variant | Service | Write | Notify |
|---|---|---|---|
| MVP1 | `FFF0` | `FFF2` | `FFF1` |
| MVP2 | `BD39` | `BDF7` | `BDF8` |

**MVP2 needs a password handshake immediately after connecting.**
Without it the heater drops the link, which bleak reports as `failed to
discover services, device disconnected` — indistinguishable from a
Bluetooth fault. Several theories were chased (BlueZ version, bluez
package missing from the container, bleak 0.22 vs 3.0) and none was the
cause: it was the missing handshake, plus genuine intermittency. Two
container rebuilds were spent on wrong guesses.

**BLE pairing is not involved.** `bluetoothctl pair` returns
`AuthenticationFailed`, consistent with the phone app never having been
paired either. Don't try to pair it.

**Only one connection at a time.** While VanOS holds the link the phone
app can't connect, and vice versa. First thing to check when either
stops working.

## Protocol

`diesel-heater-ble` (MIT, pinned in requirements) builds and parses the
packets — six protocol variants, 213 tests. It is protocol-only and
leaves the BLE transport to the caller, so the connection handling in
the plugin is ours.

## Safety guards — do not weaken these

Enforced in the plugin, not the UI, so they hold however the heater is
commanded — a future voice command or automation gets the same
protection as a button press.

- **A stop is refused during ignition.** Interrupting it leaves unburnt
  fuel in the burner and exhaust. On this van that fouled the previous
  heater badly enough that its replacement had to burn through the
  residue before it would light.
- **A start is refused during cooldown.** The heater is purging and will
  not honour it anyway.

Both check the heater's own reported `running_step`, never what we think
we last commanded — those diverge exactly when it matters. The API
returns 409 for these, which the UI shows as guidance rather than an
error.

## The screen

`/heater`, laid out to match the Hcalory phone app deliberately — big
target temperature with −/+, readings row, three mode buttons, heating
bar. That layout is already learned; no reason to invent another.

Differences from the app: controls are disabled during ignition and
cooldown **with the reason shown**, and target reads `—` rather than a
stale number when the heater is off and reports no setpoint.

High Plateau is present but disabled — it only matters above 3000 m and
this van is at sea level, so wiring it up would be pretend
functionality.

## Enabling it

Config `hcalory_heater`: MAC and PIN are already seeded. Set
`enabled: true`.

## Still to do

- **Untested against the real heater.** The protocol is proven — the
  standalone test connected, handshook and returned live readings — but
  the plugin's own connect/poll loop and every control command are
  unexercised. Expect a round of corrections.
- The `state` code mapping in the UI (0 off, 8 heating, 0xC ventilation,
  0xF fault) is from the library's constants, not observed on this
  heater. Watch it against real transitions.
- Connection proved intermittent from inside the container — the same
  command failed twice then worked unchanged. The plugin retries with
  backoff, but the real failure rate is unknown and the poll interval
  may need tuning.
