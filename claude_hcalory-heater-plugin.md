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

## ARCHITECTURE — the Bluetooth link is on the HOST

The backend container runs a continuous BLE discovery scan for the
Victron MPPT and SmartShunt. **BlueZ permits one discovery session per
adapter**, so a GATT connect from the same process collides:

    [org.bluez.Error.InProgress] Operation already in progress

Worse, once it collides BlueZ stays wedged and every retry fails the
same way. Pausing the shared scan around the connect was tried and made
it worse still — BlueZ then reported "No Bluetooth adapters found",
putting the Victron plugins at risk.

**Battery and solar monitoring matter more than the heater**, so the
heater moved out rather than the other way round.

    tools/heater_agent.py     systemd service on the Pi host, owns BLE,
                              serves HTTP on 127.0.0.1:8091
    the plugin                polls that over HTTP, no BLE code at all
    the API routes            proxy commands to it

Nothing the heater does can now disturb the Victron plugins. If the
agent dies, the heater reports unavailable and nothing else changes.

The host was also the arrangement that demonstrably worked: the
standalone test connected first time from there, repeatedly, while the
container never managed it once.

Safety guards live in the **agent**, since it is the only process that
can reach the heater and knows its live state.

## Installing the agent

    sudo pip3 install bleak bleak-retry-connector diesel-heater-ble --break-system-packages
    sudo cp backend/tools/vanos-heater-agent.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now vanos-heater-agent
    curl 127.0.0.1:8091/state

MAC and PIN are set in the service file, not in VanOS config.

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


## The connection problem, and what fixed it

**Symptom:** raw bleak connected roughly one attempt in three and
dropped within seconds to tens of seconds. The Hcalory phone app
connects in about two seconds and holds indefinitely — same protocol,
same PIN, same characteristics.

Theories chased and killed, recorded so nobody repeats them:

- **BlueZ version detection / missing `bluetoothctl` in the container.**
  Adding `bluez` removed the warning and changed nothing.
- **bleak 0.22 vs 3.0.** Matched the host's version in the container;
  no change.
- **Shared BLE scan collision.** Real, and the reason the agent lives on
  the host — but pausing the scan made it worse ("No Bluetooth adapters
  found") and risked the Victron plugins.
- **Idle timeout.** The link dropped after ~11s at 10s polling, one
  cycle plus a moment, which looked convincing. Polling at 1s to match
  the app did **not** hold the link. Theory dead.
- **Heater asleep in standby.** It connected fine while off on several
  occasions.

**The actual answer: `bleak-retry-connector`.** Both working projects
use it and we didn't.

BlueZ caches a device's GATT services on disk. When that cache goes
stale, service discovery fails against it — which is exactly the error
we kept getting, `failed to discover services, device disconnected`.
Raw bleak has no idea this is happening and just reports a disconnect.
`establish_connection` recognises that specific case, calls
`clear_cache()`, waits, and retries. With `use_services_cache=True` it
can skip discovery entirely on a reconnect — the step that keeps
failing.

It also classifies BlueZ's transient errors and backs off per error
type rather than uniformly.

`get_device()` is used rather than `BleakScanner.find_device_by_address`
because it reads BlueZ's D-Bus properties directly instead of starting
a discovery scan — which would collide with the container's Victron
scan, the very thing this agent exists to avoid.

`establish_connection` returns a live client rather than a context
manager, so the disconnect is explicit in a `finally`. Without it a
failed poll leaves BlueZ holding a half-open connection, which makes
the next attempt worse.
