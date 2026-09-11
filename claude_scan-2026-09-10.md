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

## 5. Weather plugin: blank error message — FIXED

Seen on the Plugin Health page. `backend/app/plugins/weather/plugin.py`
line 154 formats `f"Failed to fetch weather: {e}"` — and `{e}` is
empty, which means the exception's `str()` is blank. Almost certainly an
`httpx` timeout or connect error whose message is empty on this
version.

**Done.** Now includes the exception class. Confirmed the premise
rather than assuming it: `httpx.ConnectTimeout`, `ConnectError` and
`ReadTimeout` all stringify to `''`, so the old message really did
render as "Failed to fetch weather:" with nothing after it. It will now
name which of the three it is — no signal, DNS/routing, or Open-Meteo
rejecting the request.

**On switching to AccuWeather:** the arithmetic does not work. The
plugin polls every 30 minutes, which is 48 calls a day, and
AccuWeather's free tier is 50 a day — one container restart puts you
over. It also needs an API key, where Open-Meteo needs nothing, which
matters on a van that is often on patchy signal. Open-Meteo's UK data
comes from the same national models the Met Office publishes. Staying
put.

## 6. Websocket showing OFFLINE — DIAGNOSABLE NOW, cause still unknown

Top-right pill read `OFFL` during the session while the page's data was
clearly live (it was polling over HTTP fine). That means the websocket
isn't connecting but REST is — likely through the Cloudflare tunnel,
which needs websocket upgrade to be allowed for the hostname.

Checked what could be checked from the code: nginx has the upgrade
headers and a 24-hour read timeout, the frontend path and the backend
route match, and REST auth demonstrably works (the page had data). So
the obvious culprits are all ruled out and the cause is not visible
from here.

**Done: made it diagnosable rather than guessed at.** The close code is
the only thing that separates the possible reasons, and it was being
thrown away. Now captured and reported:

| Code | Meaning |
|---|---|
| 4401 | Token rejected |
| 4403 | Origin does not match Host |
| 1006 | Never connected — proxy not upgrading, or network |

Hovering the LIVE/OFFLINE pill shows it in words, and it is logged once
per distinct reason rather than on every retry.

**Do next:** hover the pill when it says OFFLINE and read what it says.
That single sentence decides the fix — and it needs no further
investigation to obtain.

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


---

# 15. Found 11 Sep: the backend was burning a full core

The camera "feeling slow" turned out not to be the camera at all.
uStreamer answers a snapshot in **4.7ms** and was running fine at
640x480. The backend had no CPU left to serve it.

`top` showed uvicorn at 93% and 296MB - 77 minutes of CPU in 78 minutes
of uptime. Two separate causes, found with `py-spy dump`:

## 15a. Voice control, 900 seconds behind real time — ADDRESSED

The log was repeating `still listening, 1800 chunks queued (~900.0s
behind real time)`. It consumed audio slower than the microphone
produced it, so the backlog grew until it plateaued and it burned a
core forever trying to catch up. Even if it had recognised a command it
would have been acting on something said fifteen minutes earlier.

Disabled by clearing the Groq key. **Memory dropped 296MB to 103MB
immediately** - the backlog was the memory problem too.

**The key observation:** the queue was **stable** at ~1,800 chunks, not
growing. So Vosk *was* keeping pace with the microphone - it had simply
fallen 900s behind during an earlier period and nothing ever drained
the queue except a wake-word detection. The most likely cause of that
earlier period is item 15b, which was eating 93% of a core. That is now
fixed, so voice may keep up unaided.

**Done:**
- **A backlog cap.** Past ~15s of queued audio the oldest chunks are
  dropped, back to ~5s. Trades completeness for currency deliberately:
  a wake word inside dropped audio is missed, but everything processed
  is recent. Permanently behind means missing them all anyway and never
  knowing. Verified the lag is bounded at ~12s rather than 900s, and
  that a consumer keeping pace never triggers a drop.
- **A real off switch.** `voice.enabled` in config, defaulting to on.
  Previously `start()` ran whenever a Groq key existed and the only way
  to stop it was to delete the key - which also breaks transcription
  and has to be typed back in from the console.

**CONFIRMED, 11 Sep: Vosk keeps up perfectly.** With the intelligence
engine fixed, the log reads:

    still listening, 0 chunks queued (~0.0s behind real time if any)

Zero, consistently. It was never too heavy for this Pi - it was starved
of CPU by item 15b re-reading eight days of history every 30 seconds.
The backlog cap should now never fire; it stays as a safety net.

**This also explains the Groq quota.** Once voice was 900s behind it was
detecting wake words in stale audio and firing a transcription call for
speech from fifteen minutes earlier - burning quota on commands nobody
had given. The quota was a symptom, not a limit being reached honestly.

**All three of the day's complaints were one root cause.** The camera
was not slow, voice was not too heavy for the hardware, and Groq was not
being overused by design. One JSON-decoding loop was eating the Pi.

**The remote speaker test has a real limitation**, worth knowing before
trusting it: it plays the command out of the headphone jack and relies
on the mic hearing it. Measured RMS 124-232 against a threshold of 150 -
barely at the trigger point, so Groq receives near-silence and
transcribes `'.'`. The pipeline is fine; the levels are not. Turn the
van's volume up before using it, or judge from a real spoken command
instead. Note the threshold is already at 150 where the help text
suggests 2500 is typical, which hints the mic runs quiet generally.

## 15b. The intelligence engine re-reading eight days, every 30s — FIXED

`py-spy` caught it in `json.loads` inside `history_service.query`,
called from `solar_history.evaluate`, **on the event loop**.

Every 30 seconds the engine re-read and JSON-decoded, from this van's
actual table:

| domain | rows over 8 days |
|---|---|
| solar | 10,656 |
| weather | 338 |
| battery | 31,833 (twice — energy balance and power predictions) |

About **42,800 rows per compute, ~7 million JSON decodes an hour**, to
recalculate daily totals that had not changed. And growing: the table
was at 154,017 rows, so it got slower every day.

**Fixed with a per-day cache** (`app/intelligence/daily_cache.py`).
Seven of the eight days are finished and cannot change, so they are
computed once and kept; only today is re-read. Measured against the
van's real row counts: **42,824 rows per compute down to 5,353, an 88%
cut** — and today's share resets at midnight rather than growing.

Required adding `until_timestamp` to `history_service.query` so a
caller can ask for one day rather than "everything since"; a bounded
window is what makes caching possible at all.

`backend/test_daily_cache.py`, 14 assertions. The ones that matter:
completed days are queried once (second run makes ONE query, not four),
today is never cached and updates as data arrives, a completed day's
value does not move, and two providers reading the same domain with
different aggregators do not collide.

**Still worth doing:** `history_service.query` runs synchronously on
the event loop. Even at 5,353 rows that blocks the camera while it
runs. Wrapping it in `asyncio.to_thread` is a small change with a real
benefit.


---

# 16. The camera was cropped, not narrow (11 Sep)

uStreamer was running at `--resolution=640x480 --desired-fps=20`, and
reporting `captured_fps: 12` - the camera could not do 20 at that size.

Checking what it actually supports:

    v4l2-ctl -d $WEBCAM_DEVICE --list-formats-ext | grep -A 6 MJPG

    MJPG 1280x720:  30 / 25 / 15 / 10 fps

**1280x720 does 30fps** - higher resolution AND smoother than the 480p12
it was set to. Changed in `/etc/systemd/system/ustreamer.service`; no
Docker involved.

The interesting part: at 640x480 this camera **crops** rather than
scaling, using a centre region of the sensor. The field of view looked
narrow and was reasonably assumed to be the lens. It was the config.
At 720p the whole van is visible.

Almost certainly set low back when the camera path went through ffmpeg,
where every frame cost ~4.1s to capture and dropping the resolution was
a sensible way to claw performance back. Once uStreamer took over, that
constraint disappeared and the setting was never revisited - the same
pattern as the camera settle gate in item 11: a workaround outliving
the problem it solved.

MJPEG is compressed in the camera's own hardware, so the Pi never
decodes it - uStreamer proxies bytes. 720p30 costs bandwidth, not CPU.

**Worth watching:** 720p30 over the Cloudflare tunnel is a lot more data
than 480p12. If the stream is poor from outside the van, the link is now
the limit rather than the Pi, and dropping to 1280x720 at 15fps would
halve it.

## The 12fps was NOT the resolution

`exposure_dynamic_framerate` was **on**, which lets the camera drop its
frame rate to expose longer in low light. Pointed at a dim van interior,
it was doing exactly that. Turning it off gives a genuine **30fps at
720p**:

    v4l2-ctl -d $WEBCAM_DEVICE --set-ctrl=exposure_dynamic_framerate=0

Made permanent with an `ExecStartPre` on the uStreamer unit, so it
survives a reboot or the camera being unplugged. uStreamer has no
`--set-ctrl` of its own; its README points at `v4l2-ctl`, which is why
it is a pre-start step rather than a flag.

The trade: it now holds 30fps in dim light rather than dropping frames
to brighten, so night footage will be darker. One command to reverse if
that matters more than smoothness.

Unexpectedly the picture got **better**, not just faster - with the
frame rate pinned the auto-exposure settles instead of hunting.

## Backlight compensation: tried, rejected

`backlight_compensation` was at 1 of a possible 121 and looked like the
obvious fix for bright windows. It is not. At 60 the whole frame blew
out to white; at 10 it was still washed out. It lifts the entire image
rather than protecting highlights, and with windows this bright there is
nothing to lift into. Returned to 1.

The scene simply has more dynamic range than the sensor holds: anything
that brightens the interior blows the windows, anything that holds the
windows darkens the interior. Only HDR or a camera not pointed at glass
fixes that. **Do not re-try this control.**

`auto_exposure` is already on (`Aperture Priority Mode`) and doing its
best.

## Three things, none of them what they looked like

- The field of view looked narrow. It was the 640x480 **crop**.
- The 12fps looked like a resolution limit. It was
  **exposure_dynamic_framerate**.
- The picture looked slow. The backend had **no CPU spare** to proxy it
  (item 15b).


---

# 17. The Google TTS key was being written into the log (11 Sep) — FIXED

`httpx` logs every request at INFO as `HTTP Request: POST <url>`, and
the Google TTS call passed its key as `?key=...`. So the full API key
was written to the log on **every single call** - and therefore into any
log dump, including ones pasted elsewhere to debug something unrelated.
That is exactly how it leaked.

**Fixed two ways:**

1. The key moves to an `X-Goog-Api-Key` header. Google accepts it for
   the same auth, so the key never reaches the URL and never reaches the
   log. Verified with a mock transport: the logged URL now has no query
   string at all.
2. `httpx`'s logger is set to WARNING. Defence in depth for any future
   call that puts a secret in a URL - and a side benefit, since the
   snapshot poll and heater agent poll were producing a line every
   second or two and burying anything useful. Errors still surface.

Checked for others: this was the only secret passed as a query
parameter anywhere in `backend/app/`.

**Still to do: rotate that key.** It is in the Pi's logs and was pasted
into a chat. It is a TTS key, so the worst case is someone burning the
character quota rather than anything serious - but it should be replaced
from the Google Cloud console when convenient.
