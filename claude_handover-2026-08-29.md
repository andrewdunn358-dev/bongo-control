# Handover — camera, trips distance, and the SmartShunt

_Written 29 Aug 2026, covering commits `8c7d859` … `f7b8700`. Frankie was
away in the van for most of this, so everything was tested on real
hardware as it shipped._

---

## The three things that actually mattered

### 1. The camera was never contended — it was polled too fast

Four architectures were built and abandoned trying to arbitrate
`/dev/video0` between snapshot polling and the live stream: a
client-side settle delay, a shared producer, a priority handover, and a
retry inside the device lock. None could have worked.

**One measurement settled it: a single snapshot takes ~4.1 seconds.**
Identical with ffmpeg and with fswebcam, and only ~0.5s of that is CPU.
The rest is opening the USB device, negotiating format and waiting for
auto-exposure. The Camera page was polling every 1500ms, so roughly
three requests queued per cycle and callers timed out on the 4s device
lock. Every "camera busy" 503 traces to that.

It also explains the dark frames: every snapshot was the camera's
*first* frame, taken before exposure settled. A bare capture that runs
for a moment returns YAVG 133, correctly exposed.

**Fix: uStreamer** (`24987de`, `3f68b47`). It holds the device open, so
exposure settles once and a snapshot is "hand me the current frame".
Measured 4.1s → **0.83s**, and the live stream is usable again because
nothing in this codebase opens the device at all any more.

- Setup is in `docs/ustreamer.md`. `CAMERA_USTREAMER_URL` unset leaves
  the old ffmpeg path untouched; any failure falls back to it.
- The Live toggle is gated on uStreamer being *reachable*, so it
  disappears by itself if the service is stopped.
- `--drop-same-frames=30` was in the first service file and is wrong for
  this job: it made the stream update every ~6s. Removed, and fps raised
  to 10 for focusing.

### 2. Trip distance was wrong because the filters were, and slow for a different reason

Distance read 403.94mi where Google Timeline said 92mi for a day it
called 76.2mi. Four filter rules — a 20m noise floor, a keepalive
interval test, a returned-nearby lookback and a speed ceiling — were all
written when points were ≥50m apart by construction. **The van now logs
every ~2 seconds** (3,528 points in one day, median gap 2s), so three of
the four fired constantly on real driving and removed 17–27% of it.

Ground truth, once Frankie checked Timeline:

| | 23 Aug | 25 Aug |
|---|---|---|
| actual | 123 mi | 92 mi |
| raw GPS sum | 130 mi | 96.6 mi |
| old four-rule filter | 95.4 mi | 76.2 mi |

The raw trail was already close. **Now one rule: reject physically
impossible speeds (60 m/s), keep everything else** (`eb6123d`). A ~5%
overcount from straight lines between points is honest; undercounting is
what gets noticed.

Separately, the page took 13 seconds. Three fixes, only the last of
which was the real one:

- `1b7fc3b` incremental distance accumulation (real, but not the
  bottleneck)
- **`7b3f281` `db.query(LocationHistory)` built 18,931 full ORM objects
  and threw them away into dicts — 4,088ms. Selecting the four columns:
  92ms.** This was most of it.
- `694aa45` the map made **141 requests and 6.6 MB** of Google tiles on
  load. Deferred until scrolled into view.
- `014a98d` both Nearby and Trips mounted MapLibre first, then tore it
  down and loaded Google when the config query resolved — **two map
  libraries downloaded per visit**.

Also added: a **backdatable trip start marker** (`c00ed02`) rather than
the requested "delete everything before this date". A marker can be set
after the fact, which matters — the request came mid-trip, when deleting
"before today" would have destroyed the drive that started it.

### 3. The SmartShunt

Fitted 29 Aug. `b729df1` adds the plugin; four follow-up commits fix
things that only broke because a second source existed:

- **`1c61e29`** BlueZ allows one BLE scan per adapter. The new plugin
  mirrored the MPPT's structure including its own `BleakScanner`, so it
  failed forever with `org.bluez.Error.InProgress`. Now a shared,
  reference-counted scanner both subscribe to.
- **`ec3674b`** with two Victron devices, each plugin fails to decrypt
  the other's packets. That is normal, and was being recorded as a
  plugin error several times a minute.
- **`4e8e95a`** history sampling throttled on domain alone, so with two
  plugins publishing BATTERY the MPPT's more frequent broadcasts
  suppressed the shunt's entirely — and what got stored was the MPPT's
  `soc_pct: None`. Now keyed on (domain, source).
- **`a6c7707`** the bus kept one latest message per domain, so the two
  plugins erased each other and the Home screen alternated between
  12.84V and 12.49V. Now merged, with the shunt winning fields both
  report (it measures at the battery post; the MPPT reads high by the
  cable drop while charging).

**Wiring gotcha, found by the data:** solar, heater and DC-DC were
connected to the battery negative *post*, bypassing the shunt. It
reported discharge while the MPPT reported 44W going in. Moving them to
the shunt's TO SYSTEM MINUS stud fixed it — confirmed by current going
positive.

---

## Smaller fixes

- `8c7d859` Ron claimed "you can call me Ron as well" — nothing in his
  prompt said what the wake word was, so he assumed his name worked.
  Now read live from config.
- `adf8b1c` the above commit anchored an insertion on `def
  _describe_capabilities(` and landed **between the decorator and the
  def**, breaking `@staticmethod`. Anchor on the decorator, not the def.
- `ddcde4e` chat `MAX_TOKENS` was 1024 with web search enabled; three
  searches consumed the budget and the model returned only `tool_use`
  blocks, surfacing as "The AI didn't return a text reply" after 30s.
  Raised to 3000, and `stop_reason` is now logged.
- Arrival announcements: read all recommendations, not just the first,
  and speak them in **chunks** — Groq Orpheus has a 1200 token/min
  ceiling and one long request returned 413 and said nothing at all.

---

## Open items

**Hardware**
- **Diesel heater — see `claude_heater-diagnosis.md`, which supersedes
  this entry.** The 22mL pump was bought but **never fitted** (connector
  mismatch), so it is NOT eliminated despite later notes saying so. The
  heater is also fed from the vehicle's fuel line via a T junction with a
  non-return valve, which no earlier note recorded. Warranty is now out
  of time.
- 100A ANL fuse for the inverter's 25mm² feed — currently unfused.
- Inline fuse on the Pi's battery feed. Open since July.
- The external battery's circuit breaker tripped from road vibration.
  Consider a fuse, or just mount it where nothing presses on it.
- Cheap DC-DC charger clicks with no hysteresis. Looked worse than it
  was: with the depleted external battery disconnected it delivered a
  steady 12.8A on a 20-minute drive.

**Measurements worth taking**
- **Base load after dark**, with and without the router. That single
  pair of readings answers the winter question, which is currently the
  biggest open worry: ~9W is 216Wh/day against maybe 30–60Wh of
  December solar.
- Whether the shunt's 100% SoC is real or a premature synchronisation.
  Watch overnight: if SoC falls far faster than consumed Ah justifies,
  re-sync after a proper mains charge.

**Software**
- Ron's capability list still offers to switch the heater and fridge.
  Neither is on a relay any more — heater is direct to battery, fridge
  is on the Victron load output.
- Ten-minute gaps in GPS logging *while driving*, which is why the raw
  trail undercounts by ~5%. Separate from the filter work.
- Settings UI for the Victron plugin credentials. Both devices were
  configured by curl; there are no fields for MAC/key.
- Docker build recompiles the frontend every time. Splitting dependency
  install from source copy would save minutes on every deploy.

---

## Lessons worth keeping

**Measure before theorising.** Six theories died on real data during the
distance investigation (decimation, the noise floor, the keepalive rule,
returned-nearby, a faulty GPS receiver, the config lock) and four
architectures were built for a camera problem that was a poll interval.
In both cases the decisive measurement took under a minute and was taken
last. The pattern was always the same: I optimised what I assumed was
slow instead of timing the parts first.

**Ground truth is worth hunting for.** Every other bug this month had
one — a multimeter reading, a `time` output, a token count in a log. The
distance bug had none until Google Timeline was checked, and it stayed
unsolved for days because of it.

**Comments about hardware go stale.** `types.ts` said `/** ALWAYS null
on this van — no shunt fitted. */`, true when written and wrong the
moment hardware changed. The same claim existed in three backend files,
each having independently assumed no shunt would ever be fitted.
