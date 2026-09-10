# Codebase scan — 10 Sep 2026, end of session

_A note of what's broken, stale or loose after two long days on the
heater. Nothing here has been fixed — this is the to-do, with enough
instruction that a fresh session can act on each item without
re-diagnosing it._

## 1. Stale docstring in the heater agent — FIXED

`backend/tools/heater_agent.py` line 9 still opens with:

> USE A SEPARATE ADAPTER (HEATER_ADAPTER, default hci1)
> This is the fix that finally worked...

Neither part is true. The default is `hci0` (line 91), and the adapter
split was **not** the fix — the poll command was. The docstring below
it (the `_query()` comment) has the correct story; this block
contradicts it from the top of the file.

**Do:** rewrite that section to say the agent runs on `hci0` sharing
with the Victron scan, that a dongle on `hci1` was tried and is not
needed, and point at `_query()` for the real cause. Same class of error
as the stale hardware comments the August handover warned about.

## 2. Two diagnostic tools now demonstrate the wrong approach — FIXED

`backend/tools/heater_probe.py` and `backend/tools/heater_mvp2_test.py`
both connect with raw `BleakClient`, and `heater_mvp2_test.py` polls
with `build_command(1, …)` — the `0A0A` time-sync packet that caused
the drops. Anyone reaching for them as a reference will reproduce the
bug.

**Do:** either add a header comment to each saying "superseded by
heater_agent.py — this uses the raw client and the time-sync query,
which is what did NOT work", or delete `heater_mvp2_test.py` (the agent
is the working reference now) and keep only the probe for discovery.
The probe is still useful for finding a MAC and identifying MVP1 vs
MVP2; just note it does not demonstrate a working connection.

## 3. `diesel-heater-ble` pinned in the container but unused there — FIXED

Added when the plugin did BLE in-container. The plugin is now a plain
HTTP client; nothing under `backend/app/` imports `diesel_heater_ble`.
It still installs on every rebuild.

**Do:** remove `diesel-heater-ble==0.3.3` from `backend/requirements.txt`.
It's needed on the **host** (for the agent) and is installed there with
pip. Keep the comment above it or move it to DEPLOY notes. Removing it
invalidates the pip layer once — do it alongside any other dependency
change to avoid a second slow rebuild.

## 4. No test covers the heater agent — FIXED

The agent has real logic — the handshake sequence, the plain-vs-timesync
query choice, three safety guards, the state shaping. The only checks
were ad-hoc scripts run in the sandbox during the session and never
committed. The four `backend/test_*.py` suites don't touch it.

**Do:** add `backend/test_heater_agent.py` in the same standalone style
as `test_battery_alarms.py`. It should at minimum assert:
- `_plain_query()` ends in `000d` and contains no `0a0a` — this is the
  regression that cost two days, and it's one line to check.
- Stop refused at step 2 (ignition), allowed at step 3 (running), start
  refused at step 4 (cooldown). These were **backwards** once already.
- Ventilate refused unless `state == 0`.
- `_shape()` reads `hcalory_status`, not `running_state`, and picks
  `set_temp` vs `set_level` by mode.
The agent module loads without hardware (tested during the session via
`importlib`), so this needs no BLE.

## 5. Weather plugin: "Failed to fetch weather:" with nothing after it

Seen on the Plugin Health page. `backend/app/plugins/weather/plugin.py`
line 154 formats `f"Failed to fetch weather: {e}"` — and `{e}` is
empty, which means the exception's `str()` is blank. Almost certainly an
`httpx` timeout or connect error whose message is empty on this
version.

**Do:** change it to `f"Failed to fetch weather: {type(e).__name__}: {e}"`
so the class name is always shown. Then it'll say `ConnectTimeout` or
`ConnectError` and you'll know whether it's the van's internet or
Open-Meteo. Not a heater problem; noted because it's on the same page.

## 6. Websocket showing OFFLINE on the Power page

Top-right pill read `OFFL` during the session while the page's data was
clearly live (it was polling over HTTP fine). That means the websocket
isn't connecting but REST is — likely through the Cloudflare tunnel,
which needs websocket upgrade to be allowed for the hostname.

**Do:** check `docker compose logs backend | grep -i websocket` and
the browser console for the WS URL it's trying. If it's `wss://` through
the tunnel, confirm the tunnel config permits websockets. Low priority
— the app works without it, it just polls instead of pushing.

## 7. Heater controls are still only lightly tested against the real unit

Confirmed working today: connect and hold, readings, `+`/`−` target,
Start blowing. **Not yet exercised:** Start heating from the page, Stop
heating, mode switch, auto start-stop toggle, and the ignition/cooldown
guards firing against a real transition (only tested with fake state).

**Do:** next time the heater's going on anyway, start it from the page
and watch the pill go Igniting → Heating, then try Stop during
ignition (should be refused with the unburnt-fuel message) and Stop
once running (should work). Note anything that doesn't match.

## 8. `hci1` dongle is wedged and unnecessary

It needs a physical unplug to recover. It is **not needed** — the agent
runs fine on `hci0` alongside the Victron scan now the poll command is
right.

**Do:** either pull it out and leave it out, or leave it plugged in and
ignore it. The service file's `ExecStartPre` still runs `rfkill unblock`
and `hciconfig hci0 up`, which is harmless either way. Don't switch back
to `hci1` without a specific reason.

## 9. The Settings page has no fields for BLE devices — FIXED

MAC and PIN live in the systemd unit as environment variables, and the
plugin's `agent_url` is in `config.json` with no UI. Same gap the Victron
plugins have (their MAC and encryption key were set by curl). All three
were flagged in the August handover and still stand.

**Do:** a Settings card per BLE device — MAC, key/PIN, enable. The
heater's would write to the systemd unit or, better, move MAC/PIN into
`config.json` and have the agent read them from there so one edit
covers both. Worth doing for all three at once since it's the same
pattern.

## 10. The 20-second round trip on heater controls — FIXED

Press a button, wait ~20s to see the result. The chain:

    heater -> agent polls every 1s
           -> container plugin polls the agent every 10s   <-- bottleneck
           -> page polls the backend every 5s

Worst case is 10 + 5 = 15s plus the heater's own delay. The container
plugin's 10s poll is the problem; the agent already has fresh state
within a second.

**Done.** `GET /api/heater` now reads the agent's `/state` on every
request instead of returning `plugin.latest`. 2s timeout - the agent is
on loopback and answers in milliseconds; if it is slow it is wedged and
waiting will not help. Falls back to the cached copy if the agent does
not answer, so a wedged agent degrades to slightly stale numbers rather
than an error page.

The page's `refetchInterval` dropped from 5s to 2s, which is now the
only remaining delay. Worst case ~3s instead of ~20s.

The plugin's own 10s poll is left alone - it exists to publish
telemetry and history, which does not need to be faster.

## 11. Camera: the post-stream settle gate is dead code — FIXED

`frontend/src/screens/Camera.tsx` defines `STREAM_STOP_SETTLE_MS = 1500`
and a `pollGateAt` state with the comment *"set when a stream is
stopped, so ffmpeg has time to release the device."* It is checked
(line 163) but **never set** - `setPollGateAt` is never called, so the
gate is always 0 and snapshot polling resumes instantly after a stream
stops. The mechanism the comment describes does not exist.

Whether this matters depends on whether snapshot-after-stream still
contends for the camera. The 31 Aug handover says µStreamer now owns
`/dev/video0` and ffmpeg is a fallback only, in which case the gate
was solving a problem that has since moved - and the right fix is to
delete both the constant and the state, not wire them up.

**Done — removed.** Confirmed µStreamer is the only streaming path:
`camera_service.stream_via_ustreamer()` raises if `CAMERA_USTREAMER_URL`
is unset rather than falling back to ffmpeg, and µStreamer holds the
device permanently as a host systemd service. Stopping a stream
releases nothing, so there is nothing to wait for.

A comment in its place records what was removed and notes that the race
returns if ffmpeg ever becomes the streaming path again — the backend's
device lock does not cover it, because `capture_snapshot()` takes the
lock and the stream's `open()` does not.

## 12. Small dead code, from `tsc --noUnusedLocals` — FIXED

- `HeaterGraphic.tsx:28` - `glow` computed, never read. Delete it.
- `api.ts:22` - `Relay` type imported, unused. Delete the import.
- `Switches.tsx:8` - `fmtUnixTime` imported, unused. Delete the import.
- `Camera.tsx:67` - `STREAM_STOP_SETTLE_MS` (see item 11).

**Done.** All four removed, and `noUnusedLocals` / `noUnusedParameters`
turned on in `tsconfig.json` so they fail the build rather than
accumulating. Verified the setting actually bites by adding an unused
const and watching `tsc` reject it.

## 13. Backend lint, wider net

`ruff --select E,F,B,ARG,SIM` finds 759, but almost all are style:
698 are line-too-long (the codebase writes long comments deliberately),
30 are `raise ... from` inside except (B904 - harmless, hides chained
tracebacks), 19 are try/except/pass that could be `contextlib.suppress`.
None are bugs. Not worth a pass.

The one real category, B008 (function call in a default argument),
came back empty when checked directly - the summary count was stale.

## 14. Lint is clean on the bug classes; the four existing suites pass

`ruff` (F401, F841, F811, E722) — no findings. `test_battery_alarms`,
`test_battery_bank`, `test_energy_balance`, `test_roof_safety` — all
pass. Frontend `tsc --noEmit` and `vite build` — clean as of the last
push.

---

Order I'd do them in: **1, 4, 3** (all cheap, all about not repeating
the last two days), then **7** the next time the heater's on, then
**5** whenever the weather thing annoys you, then **9** as a proper
job. **2, 6, 8** are housekeeping.


---

# Done in this pass

**1, 2, 3, 4, 9, 10, 11, 12** are complete. What's left:

- **5** weather plugin's blank error message (one-line change, do it
  when it annoys you)
- **6** websocket OFFLINE pill
- **7** heater controls beyond blowing/target still unexercised against
  the real unit
- **8** the wedged `hci1` dongle — needs a physical unplug, or just
  leave it

Notes on the two bigger ones:

**Item 4 — the test.** `backend/test_heater_agent.py`, 33 assertions.
Verified it actually catches both historical bugs by reintroducing them:
polling via `build_command(1)` fails three assertions, and the raw step
values fail three more including "stop ALLOWED while running". A suite
that has never failed proves nothing, so this was checked rather than
assumed. Shaping was extracted from `_query()` into a module-level
`shape_state()` so the test exercises the real function rather than a
copy of it — the first draft tested a copy, which is worthless.

**Item 9 — the Settings fields.** The backend routes existed all along
(`GET`/`PUT /plugins/{name}/config`, with secret redaction and
empty-means-unchanged already handled), plus a `/scan` endpoint. Only
the UI was missing, so configuring a Victron device meant typing a curl
into a van. There are now cards for the SmartShunt and the MPPT with
MAC, encryption key and a Scan button that fills in the strongest
nearby device.

The heater's card is deliberately different: its MAC and PIN are in the
systemd unit, because the agent runs outside the container and cannot
read this config. An editable field would be a control that silently
does nothing, so the card shows the agent URL (which is app config) and
states plainly where the rest lives, with the commands to change it.
