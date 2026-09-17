# VanOS / bongo-control — full project handover

_Written 11 Sep 2026. Amended 17 Sep 2026 (relay polarity, CI safety
gate, theme system, viewport-architecture status — see the amendment
notes and new sections below). For a fresh chat picking this up from
scratch._

> **Keep this file current.** Frankie's explicit complaint: chats end,
> context resets, and this file had drifted stale enough to actively
> mislead (wrong relay polarity, no mention of the CI gate that now
> exists). The fix is not a bigger document written once — it's this
> one, edited every session a change lands. Before ending a session
> that changed anything durable (a merged fix, a new architecture
> decision, a status change on in-progress work), update the relevant
> section here — or add a new `claude_*.md` and link it from the
> reading-order table below — **in the same session, before handing
> back.** Don't leave it as a TODO for whoever opens the next chat.

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
| `claude_relay-inuse-alarms-energy-balance.md` | Relay in-use flags, battery alarms, daily energy balance |
| `claude_cleanup-2026-08-31.md` | Dead-code/orphaned-service cleanup pass |
| `claude_issue-diesel-heater-ble.md` | Draft issue, not yet posted |
| `.github/workflows/safety.yml` + `tools/check_*.py` | **The actual enforcement.** Not just docs — CI fails the build if GPIO map, polarity, boot guard, roof watchdog/ceiling, roof interlock, position honesty, or heater guards change; see below |
| `docs/FRONTEND-CONTRACT.md` | The reasoning behind each frontend-contract rule the CI checks |

**Amended 17 Sep 2026:** the three files this table previously pointed
to here (`claude_working-preferences.md`, `claude_handover-2026-07.md`,
`claude_hardware-switch-panel.md`) do not exist in this repo — dropped.
Sessions after 11 Sep (relay in-use/alarms, a cleanup pass) are not yet
written up as a `claude_*.md` file here — `git log --oneline` and the
PR list are the source of truth for those until one is. The theme
system (PR #12) and the viewport-architecture proposal now have their
own sections in this same file (9 and 10) rather than living only in
chat history.

---

# 4. Hardware worth knowing

- **Pi 2B**, 920MB RAM. Genuinely tight. Two CPU problems this week both
  came from work on the asyncio event loop.
- **Relays:** 8-channel 12V **high-trigger** board, `active_high: True`
  (corrected 17 Sep — this doc previously said low-trigger/False, which
  is wrong; verified directly against `DEFAULT_CONFIG["relays"]` in
  `configuration_service.py` and `relay_service.py`'s own comments,
  matching every session back to 31 Jul). This exact fact — plus the
  boot guard, GPIO map, roof watchdog/ceiling and heater guards — is
  now asserted **by value** in CI (`tools/check_hardware_contract.py`),
  which fails the build if any of it drifts. That is the actual source
  of truth, not this file. Wired in parallel with two-way wall
  switches, so relay state is **"commanded", never "actual"** — the
  code is deliberate about this.
- **CI safety gate (`.github/workflows/safety.yml`), added since this
  doc was last accurate:** five jobs on every push to `main` and every
  PR — `hardware-contract` (GPIO map, polarity, boot guard, roof
  watchdog/ceiling/interlock, roof position honesty, heater guards),
  `frontend-contract` (the honesty rules in `docs/FRONTEND-CONTRACT.md`
  — e.g. no `useConnectivity()`, no `current_a` tested alone, roof
  screen must say UNKNOWN, Switches screen must disclose commanded-not-
  measured), `secrets` (blocks committed keys/`.env`/config backups),
  `backend` (byte-compile + the six safety test suites), `frontend`
  (`tsc -b` + `npm run build`, real and demo). Run any check locally
  before pushing with `python3 tools/check_hardware_contract.py` /
  `check_frontend_contract.py` — cheaper than waiting for CI to say no.
  If a check fails legitimately (the van genuinely changed), update
  `EXPECTED` in the same commit and say why — that's the intended path,
  not a workaround.
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

# 4b. Telemetry honesty rules

CI (`tools/check_frontend_contract.py`) enforces these; don't rely on
memory for them:

| Item | Actual truth |
|---|---|
| Relay state | Commanded only, never measured |
| Roof position | Unknown — no position sensor exists |
| Heater fuel | Estimated from runtime — no tank sender |
| Battery SoC | Genuine SmartShunt measurement (when a shunt is present) |
| Pi connectivity | Ethernet — no production `CONNECTIVITY` domain, derive from `useConnected()` |
| Mobile/WiFi signal | Not measured anywhere |

`BATTERY` has two publishers (Victron MPPT and SmartShunt) — never
test `current_a` alone to decide whether a shunt exists; use
`hasShunt()` from `lib/telemetry.ts`. A field's absence in the most
recent message doesn't prove the hardware is absent.

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

---

# 9. Theme system (new since 11 Sep, PR #12 merged `afdeff5`)

Portable theme packages, stored **centrally on the Pi** (not
browser-local — that was the old system, gone). Routes:
`GET/POST/DELETE /api/themes`, `GET /api/themes/{id}`,
`GET /api/themes/{id}/assets/{path}`, `GET /api/themes/limits/info`.
Packages live in `data/themes/` inside the `vanos-data` volume; browser
validates for fast feedback, backend validates again (authoritative,
zip-bomb/size guarded).

A `.vanos-theme` package is **data and assets only** — no JS/TS/React,
no arbitrary CSS that could take over the app. It can set colours,
bounded typography/density, imagery (by logical role: `hero`, `camera`,
`heater`, `roof`, `switches`, `preview` — a cockpit asks for a role and
gets the theme asset or a built-in fallback), and a bounded
`"cockpit": "instrument" | "adventure"` field (unknown/absent → safe
fallback to instrument). A theme **names** an existing cockpit; it can
never supply its own layout code.

`home.heroCamera: false` (bounded boolean, real config — confirmed in
`useThemeAssets.ts`) keeps the live camera in its own Home tile rather
than becoming the hero image.

**Freeda Burgundy** is the current portable theme in progress: light,
airy, premium, burgundy + Ford-blue accents, not the dark-sci-fi
default look. Needs `"cockpit": "adventure"` in its `theme.json` to
land on Adventure rather than falling back to Instrument.

---

# 10. Current active work — viewport-aware cockpit architecture

**Status as of 17 Sep: architecture proposed, not yet approved or
implemented.** Do not start coding this from a fresh chat without
re-confirming Andrew still wants this exact shape — check chat history
first.

**The problem:** PR #12 fixed Adventure's overflow (cards were forced
into fixed heights shorter than their content) but exposed the same
issue in Instrument — its main area needs ~727px at the real
1143×685 kiosk target against ~609px available, and whitespace-only
scaling (`useAutoFit`'s current `--fit`, 1.0→0.78) can't close a gap
that size without either shrinking things it shouldn't or reflowing.

**Proposed shape** (not yet implemented):
- Reference design space `1143×685`.
- Two independent axes: **height drives a continuous proportional
  scale** (`scaleY = availableHeight / 685`, since height is the truly
  finite resource in a no-scroll kiosk); **width drives structural
  reflow** via CSS **container queries** on the cockpit root
  (`container-type: inline-size`), replacing the existing
  `adventure.css` viewport-width media queries (1250px/760px
  breakpoints) — a container query responds to the cockpit's own
  rendered box, not the raw window, which is the more correct "no
  device tiers" mechanism.
- `scale = min(scaleY, scaleX)`, floor at **~0.6** (well above the
  ~0.33 ratio where the tightest real component — the 145px Adventure
  action tiles — actually becomes touch-unsafe). Below the floor:
  reflow (a `data-density` attribute the component's CSS responds to),
  not further shrinking.
- Sizing via a small set of CSS custom-property **design tokens**
  (reference-pixel values) consumed as `calc(var(--token) *
  var(--scale))`, replacing the current mix of hardcoded `text-[Npx]`,
  ad-hoc `clamp(Npx, Nvw, Npx)`, and the existing `--fit` multiply.
- **Touch targets are exempted from `--scale` entirely**, not just
  floor-clamped — a real finding from reading the current code: the
  `.vm-action` tiles' height is *already* on the `--fit`-scaled list
  today, contradicting the file's own comment that touch targets don't
  scale. Fix that as part of this work.
- `useAutoFit` evolves into `useViewportFit` (same anti-oscillation
  `applying`-flag pattern, generalised to both axes) rather than being
  replaced by a second competing hook.

**RENDER VERIFIED 17 Sep (headless Chromium, demo build, real device
sizes) — the earlier estimate below was wrong:** at 1143×628 (the
actual PWA size on the real tablet), `.vm-page`'s measured
`scrollHeight` is **~999px** against **~532px** available by
`useAutoFit`'s own arithmetic (`window.innerHeight - top - 12`) — even
with `--fit` already pinned at its floor (0.78). That's Adventure's
hero heading rendering **partially clipped above the visible
viewport** in the screenshot (first line "Adventure" gone entirely,
only "looks good / on you." visible). Confirmed at 1143×685 and
1143×532 too — same clipping, same floor-pinned `--fit`.

Caveat: measured against the `VITE_DEMO=true` build, which adds a
~80px "Simulated data" warning banner not present against real
hardware — true gap on real hardware is probably ~80px smaller, but
this is a ~400px shortfall, not a ~24px one. Font/spacing scaling
within touch-safe bounds (0.78 floor, per `MIN_FIT` in `useAutoFit.ts`)
cannot close a gap this size — this needs the **reflow** piece the
architecture below already anticipated, and it's needed at the
*reference* size, not just at the phone-landscape edge case originally
assumed. Not yet built.

The old estimate (1143×685 → scale 1.00; 1143×628 → ~0.92; 844×390 →
~0.57, "should fit") is superseded by the measurement above — it was
arithmetic, never rendered, and was wrong. Testing plan when the
reflow work above is built: Playwright + headless Chromium at the four
reference viewports — the same method that caught the
`fitBounds`/tile-index bugs in the offline-maps work — asserting the
scale/fit variable and that no element's `scrollHeight` exceeds its
container. (Also the method used to find the overflow above.)

---

# 12. State and plan as of 17 Sep 2026 (end of a long session)

Everything below is MEASURED against main at c7b9913, not remembered.
Numbers were taken from headless Chromium renders of the real
(non-demo) build unless stated.

## What landed today, in order

  #13 actions row was clipped and sitting on top of the footer
  #14 column count became a CONTAINER question, not a viewport one
  #15 hero yields height first; its copy survives being shortened
  #16 decorative card visuals scale with the card; battery SVG fixed
  #17 Power Flow fits a narrow card without ceasing to be a flow
  #18 the 3x3 dashboard restored as Instrument; van-* cockpit deleted
  #19 action tiles became compact controls instead of clipped ones
  #20 Power page: restored the battery inventory a screen port dropped
  #21 Adventure hero is a static image, not the live camera
  #22 tokenised adventure.css
  #23 Aurora backdrop follows the theme (+ scrim alphas rebalanced)
  #24 NavShell follows the theme
  #25 GitHub Pages preview of main
  #26 tokenised the shared .glass card - themes now reach every screen

Adventure went from 477px of overflow at 1143x628 to 23px.

## Measured state of the two cockpits

                      content  available  overflow
  adventure 1143x685    603      624         0
  adventure 1143x628    590      567        23
  adventure 1143x532    567      471        96
  instrument 1143x685   721      624        97
  instrument 1143x628   721      567       154
  instrument 1143x532   721      471       250

Andrew's real device reports 1143 x 628, DPR 1, confirmed from the
Settings -> Viewport readout in the app. Work to that number.

## The remaining work, in the order I would do it

1. TOKENISE ROOF AND SWITCHES. The last screens that ignore a theme.
   87 colour literals: cockpit-roof.css 58, cockpit-screen.css 23,
   cockpit-roof-animation.css 5, switches.css 1. Imported only by
   Roof.tsx and Switches.tsx. Came in with the bongo2 ports (7b3c421,
   1bde5a5) and never went through the token layer.
   Method is settled - it has now been done three times (#22, #24, #26)
   and the same two traps caught every time:
     a) SEPARATE the literals that defeat a light theme (surfaces,
        borders, text on a themed surface, fills, functional accents)
        from the ones that must stay (shadow/text-shadow opacity with
        no hue, photographic scrims, and text sitting ON a photograph -
        a photo is not a themed surface).
     b) MEASURE THE DARK THEME BEFORE AND AFTER by comparing resolved
        computed colours, not by looking. Tokenising is NOT colour-
        neutral: the first pass of #22 shifted 15 of 18 values, and in
        #26 mapping the card border to --line silently killed the cyan
        edge. Both were invisible in a screenshot.

2. FIT INSTRUMENT. It is 154px over at the real size. It was restored
   in #18 deliberately WITHOUT the sizing treatment, because mixing a
   restore with a resize is how it went wrong the first time. It now
   needs what Adventure got: container queries for structure, scaling
   for decoration only, touch targets exempt.

3. ADVENTURE'S LAST 23px at 1143x628. Small enough that it may fall out
   of the composition-ladder work below rather than needing its own
   pass.

4. THE COMPOSITION LADDER (phone landscape). Home.tsx uses
   useIsWideScreen(900); below that it renders Instrument directly and
   ignores the theme, so 844x390 never sees Adventure at all. Container
   queries already handle WIDTH since #14. What does not exist is the
   HEIGHT side: a cockpit deciding it cannot fit its composition and
   reflowing to a smaller one (slim hero, cards two-up, tiles 2x2)
   rather than shrinking or scrolling. This was in the architecture
   ChatGPT reviewed and is the last unbuilt piece of it.

5. FREEDA FORD's remaining assets. The package validates clean against
   the real schema, and heroCamera at TOP level is correct (the parser
   reads theme?.heroCamera; nesting it under home would be ignored).
   Two problems, both imagery:
     - switches.jpg is a 250x120 SCREENSHOT OF THE COCKPIT, showing a
       switch tile and the Camera tile complete with its arrow. Needs a
       real photograph of the van's switch panel.
     - no camera asset, so that tile falls back to /hero/lake_night.jpg,
       a dark night photo inside a daylight theme.
   Also ink-faint at 170 152 158 measures 2.73:1 for the footer slogan
   on white; about 146 124 132 fixes it.

6. cam1-5.jpg ARE NOT IN public/ AT ALL. demo.ts references them, so
   demo camera frames 404 - on the Pages preview and on the Pi's own
   demo build. Pre-existing, unrelated to any of today's work.

7. camera-live-producer: THREE FINISHED COMMITS, NEVER OPENED AS A PR.
   A shared Live producer so streaming and snapshots stop fighting for
   /dev/video0, plus making a 503 visible instead of silent. Verified
   against the API: no PR has ever existed for this branch. Worth
   reviewing and landing or deleting - not leaving.
   Also stale: fix-adventure-camera (2 commits) and
   fix-adventure-camera-pr (3) - the Freeda Bright theme work.

8. RESTORE THE DELETED RATIONALE. #23 and #24 each stripped comments
   while keeping the code, ~26 lines in NavShell alone. Gone with them:
   why there is no backdrop-blur on the header and dock (reported
   "horribly slow" on a budget Android; opacity alone let ghost text
   bleed through), and why the brand mark is imported rather than
   referenced from public/ (an unversioned filename is always served
   stale by the service worker). Both are findings this project paid
   for once. The behaviour still holds; the reasons do not, so someone
   will undo them.

## Not reproduced, do not chase blind

A stray "null" appeared bottom-right on the Roof page in a desktop
screenshot. Checked and NOT found: no DOM element renders the text
"null" on that page, no anchor/img/video carries a null or empty
href/src, and videoSrc is initialised to a string constant and is never
null. In the same corner an earlier screenshot showed "185.199.10",
which is Chrome's link-target bubble - so this may be the browser, not
the app. If it recurs, capture what is under the cursor.

## The roof video

Works - confirmed playing on desktop. If it is missing on the tablet,
the deployed build predates 7b3c421 or the PWA is on a stale service-
worker shell. Reopen the PWA. Files are tracked in git and the paths
already resolve through import.meta.env.BASE_URL.

---

# 11. Verification discipline

**Always distinguish BUILD VERIFIED from RENDER VERIFIED.** A clean
`tsc`/`vite build` proves the code compiles; it does not prove a
cockpit visually fits or looks right. State plainly which one you did
when reporting work — never imply a screenshot check happened when
only the arithmetic did.

**Before committing anything touching hardware/frontend contracts:**

```bash
python3 tools/check_hardware_contract.py
python3 tools/check_frontend_contract.py
cd frontend && npx tsc -b && npm run build && VITE_DEMO=true npm run build
```

If a guard fails, find the real cause — do not work around it. If the
physical van genuinely changed, update `EXPECTED` in
`tools/check_hardware_contract.py` in the *same* commit and say why.

**Never commit:** secrets, `.env`, `config.json`, encrypted backups,
credentials, or private configuration. The `secrets` CI job blocks the
obvious cases but isn't a substitute for not doing it.
