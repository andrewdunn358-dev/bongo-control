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

**Service caching is OFF.** It was tried (`use_services_cache=True`) and
made things worse: skipping discovery meant BlueZ handed back a cached
characteristic it could no longer resolve, and `start_notify` failed
with `[org.freedesktop.DBus.Error.UnknownObject] Method "StartNotify"
... doesn't exist`. A slow rediscovery that works beats a fast one that
returns a stale handle.

**Stale connections are cleared BEFORE each attempt**, not only after a
failure. `establish_connection` retries internally, so a client left up
by a previous attempt produced `Client is already connected` and burned
all four retries without ever reaching the heater.

`get_device()` is used rather than `BleakScanner.find_device_by_address`
because it reads BlueZ's D-Bus properties directly instead of starting
a discovery scan — which would collide with the container's Victron
scan, the very thing this agent exists to avoid.

`establish_connection` returns a live client rather than a context
manager, so the disconnect is explicit in a `finally`. Without it a
failed poll leaves BlueZ holding a half-open connection, which makes
the next attempt worse.


## THE ACTUAL CAUSE — one radio, two consumers

Everything before this was treating symptoms. An HCI capture settled it:

```
sudo btmon -w /tmp/heater.btsnoop &
```

The connection to the heater **succeeded** — handle assigned, 15ms
interval, 3s supervision timeout, remote features read. What failed was
a BlueZ management command, `Start Service Discovery`, returning
`Authentication Failed (0x05)`. Moments later the adapter itself was
removed and re-added (`Index Removed`, `Delete Index`).

The container's log explained why:

```
No Victron advertisement in 61s, restarting BLE scan
```

**The Victron plugin has a watchdog.** Our connection disturbed its scan
enough that advertisements stopped arriving, so after 61 seconds it tore
the scan down and restarted it — killing our connection. We reconnected,
Victron went quiet again, and round it went. That is the ~1 minute
rhythm seen throughout, and why a standalone script worked while the
agent never could: the script ran when nothing else was competing.

Moving the agent out of the container was necessary but **not
sufficient** — host and container still shared one radio.

**Attempted fix: a second Bluetooth adapter** — a USB dongle on `hci1`
for the heater, `hci0` left to the Victron scan. This is what both
upstream projects recommend, and it **did not turn out to be the
answer**: see "Where it actually landed" below. Pinned in two places,
because `establish_connection` creates its own client and would
otherwise fall back to the default adapter:

- `get_device_by_adapter(MAC, "hci1")` rather than `get_device()`, which
  searches every adapter and would hand back the device as seen by hci0
- `adapter="hci1"` on `establish_connection`

If the dongle is ever removed this fails cleanly rather than stealing
hci0 back and taking battery monitoring down with it.

**The dongle comes up soft-blocked by rfkill after a reboot**, so the
service has an `ExecStartPre` that unblocks it and brings `hci1` up.
That needs root, hence `User=root`.


## Where it actually landed

The adapter split did not fix it, and the write-up above should be read
with that in mind.

What happened when the dongle went in:

- On `hci1` the heater connected **reliably, first attempt** — a real
  improvement over the shared-adapter mess. But it still dropped after
  6–19 seconds.
- Moving to `hci0` produced constant `Client is already connected`.
- `hci1` then wedged (`Can't init device hci1: Connection timed out`)
  and would not come back from software, surviving a full reboot. **It
  needs a physical unplug** to re-enumerate on USB.
- Settled on `hci0`, sharing with the Victron scan, which works.

**The remaining fault: `Reason: Remote User Terminated Connection
(0x13)`.** The heater deliberately hangs up after a few seconds. Not a
timeout, not interference, not a stale cache — it chooses to. Confirmed
in an HCI capture.

Ruled out along the way: the phone app holding the link (Bluetooth off
on the phone, same behaviour), an idle timeout (polling at 1s to match
the app made no difference), and BlueZ's stored connection parameters
(cleared, no change).

**Not solved.** The phone app connects in two seconds and holds
indefinitely, so it does something at connect time we don't. Finding
out needs a btsnoop capture from the phone — and the Honor handset does
not write the standard log file (`btsnoop.file.create` stays false even
after enabling the developer option and rebooting), so that route is
closed on this phone.

**What works today:** the agent reconnects automatically, so a fresh
reading arrives roughly every 20 seconds. For heater state that is
usable. Commands land if the link happens to be up, and return 503 with
"try again" if not.

## Known outstanding

- `hci1` needs a physical unplug/replug at the van.
- Control commands are still **untested against the real heater**.
- The reconnect cycle is cosmetically noisy in the journal.


## SOLVED — it was the poll command

Re-reading everything from the start, and then reading the working Home
Assistant integration's *coordinator* rather than just its protocol
library, found it.

`diesel-heater-ble` 0.3.3's `build_command(1)` on an MVP2 device returns
the **`0A0A` packet — which is the time-sync command**, carrying
HH:MM:SS for the heater to set its clock from. The library's own
comments say so; I'd read them and not joined the dots. We were polling
with it once a second. So every second we told the heater to set its
clock, and after a few seconds of that it terminated the connection —
`0x13 Remote User Terminated`, the reason code the capture showed.

The working integration stopped doing this: *"The library now defaults
to MVP1 query since Acropolis9064 proves it works"*, falling back to
`0A0A` only if the plain query gets no reply. That change isn't in the
PyPI release yet, which is why following the library faithfully
reproduced the bug.

The plain query is `0E04` with a `POWER_QUERY` byte, and its payload
ends in **`000d`** — byte-for-byte the "pump data" command in
`evanfoster/hcalory-control`, the very first library read for this
project, on day one. The characteristics changed between MVP1 and MVP2.
The status query did not. It was in the first plugin I wrote and I threw
it away when switching libraries.

**Now:** handshake → one `0A0A` time sync on connect (as the integration
does) → poll with the plain `0E04` query.

Everything else chased along the way — the scan collision, the idle
timeout, the service cache, the second adapter, stored connection
parameters — was real in its own small way or a red herring, but none of
it was the cause. The lesson is the one the handover already states:
**measure before theorising.** The decisive evidence was reading the
code that works rather than the library it wraps, and that took ten
minutes once it was the thing being done.

Service file defaulted back to `hci0`; the dongle on `hci1` is not
needed for this and is currently wedged anyway.
