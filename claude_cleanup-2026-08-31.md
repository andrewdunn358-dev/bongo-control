# Cleanup pass — what was dead, what was already fine

_31 Aug 2026. A full audit for broken code, dead weight and speed-ups.
Findings are listed honestly, including the ones where the answer turned
out to be "already fixed, leave it alone" — that half is worth recording
so the next session doesn't re-audit the same ground._

Net: **278 lines deleted, 72 added.**

---

## The big one — PowerBudgetService was computing for nobody

`PowerBudgetService` ran a 30-second loop that, every time it fired:

- queried **six hours of battery history from SQLite**, synchronously,
  on the event loop
- computed estimated runtime, heater-all-night and tomorrow's outlook
- published them to the `SYSTEM` telemetry domain

Nothing read any of it. Not one line of the frontend calls `useSystem()`
or `api.system()`. No backend service reads `TelemetryDomain.SYSTEM`. The
intelligence layer's `PowerPredictionProvider` and `SolarOutlookSignalProvider`
had taken over every one of those figures, and the Overview screen reads
the mission brief instead.

The tell that settled it: `SystemPayload` in `types.ts` described
`cpu_pct / ram_pct / uptime_s` — a completely different shape from what
the service actually published. The two had never been connected.

`IntelligenceRunner`'s own docstring predicted this exactly: *"Consolidating
the duplication between PowerBudgetService and the new Signal/Prediction
providers is a reasonable future cleanup once this is proven working."*
It was proven working. This is that cleanup, about a month late.

**Deleted:** the service (181 lines), its lifespan wiring, the dead
`/api/system` route, `SystemPayload`, `useSystem()`, `api.system()`. Also
removes a duplicated `_estimate_typical_load_watts()` — the same
six-hour history query existed in two files and ran on two independent
loops.

**On a Pi 2B this is a real recovery**, not a tidy-up: one fewer bus
subscriber, one fewer 30-second timer, and one fewer blocking SQLite
read off the SD card every 30 seconds, forever.

---

## Stale references to a class that no longer exists

Deleting it left `PowerBudgetService` named in **fourteen comments**
across nine files, several of them actively misleading — `runner.py`'s
docstring still explained why it "runs ALONGSIDE PowerBudgetService",
describing a design decision that had just been reversed.

All fourteen updated. This is the same failure the last handover called
out about hardware comments (`types.ts` claiming "no shunt fitted" long
after one was): **when something is deleted, grep its name across the
whole codebase, not just its imports.** Imports are checked by the
compiler; comments are not checked by anything.

---

## Build speed — the typecheck doesn't belong in the image

`npm run build` was `tsc -b && vite build`. Measured on a fast x86 box:
**tsc 12.0s, vite 15.9s** — the typecheck is 43% of the build.

vite transpiles TypeScript with esbuild, which strips types without
checking them, so the typecheck contributes **nothing to the artifact**.
It is pure verification, and it has already happened by the time anything
reaches the Pi — verify, push, pull is the workflow, and `tsc --noEmit`
is part of the verify step.

On a Pi 2B it is worse than proportional, because it competes for the
same scarce RAM that already made vite's chunk-rendering step run out of
heap (hence the `NODE_OPTIONS` line above it in the Dockerfile).

The image now runs `npm run build:image` (`vite build` only). `npm run
build` still typechecks for humans and CI. The trade: a type error would
no longer fail the build on the Pi — but it would not be *caused* there,
and it would break at runtime identically either way. Finding out on the
van after a multi-minute rebuild is the worst possible place.

---

## Smaller dead weight removed

- **`/relays/{id}/toggle`** — route, client method, service method and
  demo stub. Nothing called it; the Switches screen computes the target
  state and calls `/set`, which is also the safer pattern (toggle can't
  know what it will land on, which is why it needed its own roof guard).
- **Two unused imports** (`typing.Awaitable`, `typing.Any`).
- **Stale unlock copy.** `Switches.tsx` still said *"unlock on the Camera
  screen first"* on a 401. `AppGate` has handled unlocking globally for
  a while and the Camera screen has no unlock UI — the last loose end of
  H3 from the July review.

---

## Audited and deliberately left alone

Recording these so they don't get re-investigated:

- **MapLibre (801 KB) is NOT dead** despite the move to Google Maps. It's
  the offline/no-API-key fallback, which is the whole point on a van. It
  already lives in its own lazily-loaded chunk, so it costs nothing until
  a map screen is opened. Only its CSS is in the main bundle.
- **H1 (sync DB on the event loop)** — largely resolved already. The
  coverage handlers use `asyncio.to_thread`, and the history/relay-event
  reads are plain `def`, which FastAPI runs in a threadpool. Only
  `coverage/status` is `async` without awaiting, and it reads config from
  memory.
- **H5 (whole app re-rendering on every telemetry tick)** — fixed.
  `useSyncExternalStore` with per-slice selectors, and `App` subscribes
  via `useConnected()` only.
- **M2 (unbounded growth / O(n) haversine)** — fixed. There's a bounding-box
  `WHERE` before the haversine and age-based pruning.
- **C3 (POI category mismatch)** — fixed. Frontend `CATEGORY_META` keys
  now match the backend's six categories.
- **DB indexes** — present, including the composite `ix_domain_timestamp`.
- **Docker context** — already well handled; `.dockerignore` is thorough
  and `npm ci` is correctly in its own cached layer.
- **The remaining REST snapshot methods** (`api.battery`, `api.solar`,
  etc.) are unused but now *correctly* typed as `TelemetryMessage<T>`
  envelopes. L2 asked to "fix the types or delete the methods" — the
  types were fixed, so they're a valid unused API rather than a landmine.
  Left in place; deleting correct code purely for being unused is churn.
- **Eight unused test IDs** (`gate`, `unlockBtn`, `netEnergy`,
  `overlayMap`, …). Harmless constants, plausibly wanted by future tests.
  Noted, not removed.

---

## `/relays/all-off` — looked like a gap, was actually a false claim

Flagged initially as a missing button: the endpoint exists, is
auth-gated, and its docstring called it a *"panic switch … a reasonable
thing to reach for before leaving the van"*, but nothing in the app can
call it.

**Frankie's answer: don't add the button, because we don't know the
state of the switches.** That is the correct call and a better reason
than the one that prompted the question. Every circuit is two-way — the
relay sits in parallel with a physical wall switch, so the load state is
the relay AND the switch position combined. Commanding a relay off does
not mean the load goes off, and if that circuit's switch is sitting on
the other side, "all off" is exactly as likely to switch a load **on**.
`relay_service.py` has known this from the start (it's the same
reasoning behind restore-on-startup, and behind the hours-long mystery
an unconditional all-off once caused) — the route's docstring had simply
never been held to it.

So the fix was to the docstring, not the UI. It now says what the call
actually does — return every channel to a known *commanded* state, which
is honestly useful from a script or before testing — and states plainly
that it is not a panic switch and should not get a button, because any
label a user would understand would claim more than the wiring can
deliver.

Worth generalising: **a missing UI is sometimes a correct UI.** The
question to ask before adding a control is not "is this endpoint
reachable" but "can the hardware keep the promise the label makes".

---

## Verification

Backend imports clean; all four test scripts pass (battery bank, battery
alarms, energy balance, roof safety). `tsc --noEmit` clean, `vite build`
clean, `npm run test:maps` clean.
