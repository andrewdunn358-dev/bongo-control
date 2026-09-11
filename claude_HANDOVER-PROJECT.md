# VanOS / bongo-control — full project handover

_Written 11 Sep 2026. For a fresh chat picking this up from scratch._

---

# 0. FIRST: getting git push working

A new session usually **cannot push** until this is set up. It is not
the token being wrong. Do this before anything else, then get on with
the work.

## The setup that works

```bash
git clone https://github.com/andrewdunn358-dev/bongo-control.git
cd bongo-control

# Credential store, so the token is not in the remote URL or in any
# command that ends up in a log.
git config credential.helper 'store --file=/home/claude/.gitcreds'
printf 'https://andrewdunn358-dev:PASTE_PAT_HERE@github.com\n' > /home/claude/.gitcreds
chmod 600 /home/claude/.gitcreds

git config user.name  "Frankie"
git config user.email "frankie@synthesis-it.co.uk"

# Prove it BEFORE building anything - this costs nothing and saves an
# evening.
git push --dry-run origin main
```

Frankie supplies the PAT. It needs `repo` scope. Ask him for it in chat
and paste it into the command above — **do not write it into any file
that gets committed**, because that file ends up in the repo history and
in the transcript.

## If the dry-run still fails

Read the error before assuming it is the token:

- **`access denied by the git proxy: … is not in this session's
  authorized repository set`** — this is the sandbox proxy, not GitHub,
  and **no token can get past it**. Proven in August: a deliberately
  fake token gives a byte-identical error, so GitHub never sees the
  request. If there is an `add_repo` tool, call it for
  `andrewdunn358-dev/bongo-control` with `access: "push"`. If not, say
  so immediately and deliver work as a patch instead (below). Do not
  ask Frankie to re-issue the token; it is not the problem.
- **`401 Bad credentials`** — this one *is* the token. Expired or wrong
  scope.

## Delivering work when push is blocked

```bash
git format-patch -1 --stdout > change.patch
```

Send it to Frankie. The repo lives on the **Pi** at `~/bongo-control`
(his Windows desktop has no checkout), so he runs:

```bash
cd ~/bongo-control
git am < change.patch
git push
```

## Pushing from the Pi

The Pi's own remote has credentials embedded, so `git push` there works
without any of the above. If it ever asks for a password:

```bash
git remote set-url origin https://andrewdunn358-dev:PAT@github.com/andrewdunn358-dev/bongo-control.git
```

---

# 1. What this is

A campervan control system for a 1995 Mazda Bongo. FastAPI + SQLite
backend, React/TypeScript PWA frontend, docker-compose on a **Raspberry
Pi 2B** in the van, reachable remotely via a Cloudflare tunnel.

Repo: `https://github.com/andrewdunn358-dev/bongo-control`, branch
`main`. The Pi deploys from `main`.

It does: battery and solar monitoring (Victron BLE), GPS and trip
logging, 12V relay control, a pop-top roof actuator, camera, weather,
4G coverage lookup, offline maps, voice control, and a diesel heater.

---

# 2. Deploy — always say which tier applies

Handing over the slowest command every time wastes a lot of his day.

| Change | Command | Time |
|---|---|---|
| `backend/tools/` (host agent) | `git pull && sudo systemctl restart vanos-heater-agent` | seconds |
| `backend/app/` only | `docker compose --profile cloudflare-tunnel up -d --build backend` | ~30s |
| Frontend, or any dependency file | `docker compose --profile cloudflare-tunnel up -d --build --remove-orphans` | 5–25 min |

**Never change `requirements.txt` or `package.json` for tidiness.**
Removing one unused line cost a 24-minute rebuild: pip 421s, apt 542s,
frontend 424s. Measured, in `claude_build-cost.md`. Batch dependency
changes with other work that needs a full rebuild anyway.

Getting a file onto the Pi with no build at all:

```bash
docker cp backend/tools/thing.py $(docker compose ps -q backend):/app/tools/
```

---

# 3. The docs in the repo, in reading order

| File | What |
|---|---|
| `claude_handover-2026-09-11.md` | The most recent session |
| `claude_scan-2026-09-10.md` | **The running to-do.** 19 items, most resolved, with what was tried and why |
| `claude_build-cost.md` | Build times and deploy tiers |
| `claude_hcalory-heater-plugin.md` | The whole heater story |
| `claude_working-preferences.md` | Git/push behaviour, communication |
| `claude_handover-2026-07.md`, `claude_hardware-switch-panel.md` | Wiring, relays, GPIO map |
| `claude_issue-diesel-heater-ble.md` | Draft issue, not yet posted |

---

# 4. Hardware worth knowing

- **Pi 2B**, 920MB RAM. Genuinely tight. Two CPU problems this week both
  came from work on the asyncio event loop.
- **Relays:** 8-channel 12V **low-trigger** board, `active_high: false`.
  Wired in parallel with two-way wall switches, so relay state is
  **"commanded", never "actual"** — the code is deliberate about this.
- **GPIO map is in `DEFAULT_CONFIG["relays"]`** in
  `configuration_service.py`. That is the source of truth; docs have
  been wrong before. **GPIO 25 / physical pin 22 is dead** on this
  board — do not reuse it.
- **Roof:** relays 7/8 reversing bridge, 5/6 isolate the OEM switch.
  Hold-to-run with a watchdog and a 30s ceiling. Excluded from the plain
  relay API at route level.
- **Batteries:** 120Ah leisure + 130Ah external, Anderson-linked when
  fitted. Victron SmartShunt and SmartSolar MPPT over BLE. A second
  solar panel runs through a PWM controller to the external battery,
  which is invisible to the shunt.
- **Camera:** USB webcam via **uStreamer** on the host (not ffmpeg).
  1280x720 @ 30fps.
- **Heater:** Hcalory 2kW, plumbed into the **vehicle fuel tank**.

---

# 5. The heater — the big piece

Working: connects over BLE, reads live, controls from the app.

- `Heater5579`, `20:25:05:19:0D:33`, service **BD39 (MVP2)**, PIN 0000,
  on `hci0`.
- BLE lives in **`backend/tools/heater_agent.py`, a systemd service on
  the Pi host** — not in the container, because the container's Victron
  BLE scan collides with a GATT connect. The plugin polls the agent over
  HTTP on `127.0.0.1:8091`.
- **The bug that cost two days:** `diesel-heater-ble` 0.3.3's
  `build_command(1)` on MVP2 returns the **time-sync** packet. Polling
  with it once a second makes the heater terminate the connection (HCI
  `0x13`). The agent builds the plain `0E04` query directly and
  time-syncs once on connect. `backend/test_heater_agent.py` asserts the
  poll ends in `000d` — **that assertion is the regression guard, do not
  remove it.**
- **Safety guards live in the agent**, not the UI, so they hold however
  the heater is driven: stop refused during ignition (unburnt fuel
  fouls the exhaust — it destroyed the previous heater), start refused
  during cooldown, ventilation only from standby. Confirmed working in
  the van 11 Sep.
- **Untested:** the ignition guard against a real ignition.

**When it will not connect: reboot the Pi first.** Faster than
diagnosing and doable remotely. On 11 Sep an afternoon of
`bluetoothctl disconnect`/`remove`/`hciconfig reset` left BlueZ refusing
service discovery while reporting `Connected: no`; only a reboot cleared
it. The heater was never at fault.

---

# 6. Traps that have each cost hours

- **`config.json` is overwritten on shutdown.** Editing it while the
  backend runs silently loses the change. Stop, edit, start.
- **`docker compose exec` starts a separate process** — its
  `configuration_service.set()` never reaches the running app.
- **Shallow config merge:** new keys added to an *existing* section only
  reach fresh installs. Frankie's saved config will not pick them up.
- **py-spy is not in the image** and found both CPU problems this week:
  `docker compose exec backend pip install py-spy` then
  `py-spy dump --pid 1`.
- **Stale test fakes.** Adding an argument to a real method silently
  breaks fakes that do not have it — this disabled the roof suite for
  weeks. Run every suite after touching a shared signature.

---

# 7. The pattern worth chasing

Everything found this week was a **workaround outliving the problem it
solved**, or a tuning number set against conditions that have since
moved:

- The camera at 640x480 was compensating for ffmpeg's 4-second frame
  capture. uStreamer replaced ffmpeg; the setting stayed. It was also
  *cropping*, which looked like a narrow lens.
- The intelligence engine re-read 8 days of history every 30s. Fine when
  the table was small; it is now at **154,000 rows**.
- Voice control "too heavy for the Pi" was CPU starvation from the
  above. With it fixed: **0 chunks queued**.
- A camera "settle gate" whose comment described behaviour that never
  happened.

**Still unexamined:** `telemetry_readings` growth (downsampling old data
to hourly is the fix), the heater agent's 1s poll, the 30s recompute,
the 48kHz mic feed Vosk resamples on every chunk.

---

# 8. How Frankie works

Short answers, lead with the answer. Diagrams for hardware. He relies on
Claude for all the coding but knows his infrastructure thoroughly — he
runs an MSP and has been doing this a long time.

The Pi is in the van and he often is not. Do not hand him terminal
homework that could be solved from here, and **say plainly when
something genuinely needs him at the van.**

He is right more often than the first evidence suggests. Take "it was
working until you changed something" seriously and go and check — on
11 Sep no commit had touched the connection path, but he was right that
something had changed, and it was accumulated BlueZ state from the
debugging itself.

**Measure before theorising.** Every wrong turn this week came from
reasoning about a symptom instead of capturing evidence. `py-spy dump`
and `btmon` each settled in one shot what hours of guessing had not.
