# VanOS — handover, 11 Sep 2026

_For a fresh chat. Two long days: the heater went from three weeks of
failed ignitions to working and controllable from the app, and a
performance problem that had been quietly worsening for months got
found and fixed._

## Read these first

- `claude_scan-2026-09-10.md` — the running list. Nineteen items, most
  resolved, with what was tried and why. **Items 5–8 and 18 are what's
  left.**
- `claude_build-cost.md` — **read before touching any dependency file.**
  Measured build times and the three deploy tiers.
- `claude_hcalory-heater-plugin.md` — the whole heater story.

## Deploy: say which tier applies

Handing over the full command every time wastes a lot of Frankie's day.

| Change | Command | Time |
|---|---|---|
| `backend/tools/` (host agent) | `git pull && sudo systemctl restart vanos-heater-agent` | seconds |
| `backend/app/` only | `docker compose --profile cloudflare-tunnel up -d --build backend` | ~30s |
| Frontend, or any dependency file | `docker compose --profile cloudflare-tunnel up -d --build --remove-orphans` | 5–25 min |

**Never change `requirements.txt` or `package.json` for tidiness.** Doing
it for one unused line cost a 24-minute rebuild. See
`claude_build-cost.md`.

## The heater

Working. Connected over BLE, reads live, controls from the app.

- Hcalory 2kW, `Heater5579`, `20:25:05:19:0D:33`, service BD39 (MVP2),
  PIN 0000, on `hci0`.
- BLE lives in `backend/tools/heater_agent.py`, a **systemd service on
  the Pi host** — not in the container. The container's Victron scan
  collides with a GATT connect.
- **The bug that cost two days:** `diesel-heater-ble` 0.3.3's
  `build_command(1)` on MVP2 returns the *time-sync* packet. Polling
  with it once a second makes the heater hang up (HCI `0x13`). The agent
  builds the plain `0E04` query directly and time-syncs once on connect.
  `backend/test_heater_agent.py` asserts the poll ends in `000d` — that
  one line is the regression guard.
- **Confirmed in the van, 11 Sep:** the cooldown guard works. Pressing
  anything during shutdown is refused and the UI explains why.
- **Still untested:** the ignition guard. Press stop *while it is
  lighting* — it should refuse with the unburnt-fuel message.

### When it won't connect: reboot the Pi first

Faster than diagnosing, works from anywhere, and on 11 Sep it was the
fix. An afternoon of `bluetoothctl disconnect`/`remove`/`hciconfig
reset` left BlueZ refusing service discovery while reporting
`Connected: no`. Nothing else cleared it. The heater was never at fault.

## What got fixed that nobody had noticed

All four were **workarounds outliving the problem they solved.** Worth
looking for more of the same.

1. **The intelligence engine was burning a full core.** Re-reading and
   JSON-decoding 42,800 telemetry rows every 30 seconds to recompute
   daily totals that had not changed. Fixed with a per-day cache
   (`app/intelligence/daily_cache.py`) — completed days are computed
   once, only today is re-read. **88% cut.** uvicorn went from 93% CPU
   to not appearing in `top`.
2. **The camera was cropped, not narrow-lens.** 640x480 makes this
   camera use a centre region of the sensor. And the 12fps was
   `exposure_dynamic_framerate`, not a resolution limit. Now 1280x720 at
   a real 30fps with the whole van in frame.
3. **Voice control was not too heavy for the Pi.** It was starved by
   (1). With that fixed it reports **0 chunks queued**. It had been 900
   seconds behind, which also explains the Groq quota — it was firing
   transcription calls for speech from fifteen minutes earlier.
4. **The camera "settle gate" was dead code.** Its comment described
   behaviour that never happened; the setter was never called.

## Open — needs Frankie at the van

- **Ignition guard** (above).
- **Heater start/stop and mode buttons** from the app, against the real
  unit. Only blowing and the target have been exercised.
- **`hci1` dongle is wedged** and needs a physical unplug. It is not
  needed — the agent runs on `hci0`.

## Open — anywhere

- **Item 18:** the agent cannot find the heater after an idle period.
  `get_device()` reads BlueZ's cache and nothing scans, so after a
  reboot the device is not there. Should run one short scan itself on a
  miss.
- **Item 6:** websocket shows OFFLINE. Now **self-diagnosing** — hover
  the pill and it names the cause (4401 auth, 4403 origin, 1006 proxy).
  One hover decides the fix.
- **Rotate the Google TTS key.** It was being logged on every call
  (fixed — it moves to a header now), so the old one is in the Pi's logs
  and in a chat. TTS key, so worst case is someone burning the character
  quota.
- **Post the issue draft.** `claude_issue-diesel-heater-ble.md`, to
  `https://github.com/Spettacolo83/diesel-heater-ble/issues` — the
  library repo, **not** the Home Assistant one. The fix is already on
  their `main`; PyPI 0.3.3 predates it, so anyone starting from `pip
  install` hits what cost us two days.

## Worth looking at next

Everything found this week was a **tuning number set against conditions
that have since changed.** That is where to look:

- `telemetry_readings` is at **154,000 rows** and growing. Sampling every
  60s made sense before it was a year's worth. Downsampling old data to
  hourly would fix it permanently — it is item 3 in the original
  performance options and the only one not done.
- The heater agent polls every **1 second** because it was set there
  while debugging. Never re-measured.
- The intelligence engine recomputes every **30 seconds**. Same.
- Voice: the mic runs at **48kHz** and Vosk resamples to 16kHz on every
  chunk. Downsampling first would cut real work. Not needed while it
  keeps up, but it is the lever if it stops.

## Things that will bite you

- **`config.json` is overwritten on shutdown.** Editing it while the
  backend runs silently loses the change. Stop, edit, start. This cost
  two debugging rounds.
- **`docker compose exec` starts a separate process** — its
  `configuration_service.set()` does not reach the running app.
- **Voice control has an off switch now** (`voice.enabled`). Do not
  disable it by deleting the Groq key; that also breaks transcription
  and has to be typed back in from the console.
- **py-spy is not in the image.** It found both CPU problems this week
  and has to be reinstalled each rebuild:
  `docker compose exec backend pip install py-spy` then
  `py-spy dump --pid 1`. Worth adding to requirements next time
  something else forces a pip rebuild.

## How Frankie works

Short answers, lead with the answer. Diagrams for anything hardware.
The Pi is in the van and he is often not — do not hand him terminal
homework that could be solved from here, and say plainly when something
genuinely needs him at the van.

He is right more often than the evidence first suggests. On 11 Sep he
said "it was connecting all day until you changed something" — checking
properly showed no commit had touched the connection path, but he was
right that something had changed, and it turned out to be accumulated
BlueZ state from the debugging itself.

**Measure before theorising.** Every wrong turn this week came from
reasoning about a symptom instead of capturing evidence. `py-spy dump`
and `btmon` each settled in one shot what hours of guessing had not.
