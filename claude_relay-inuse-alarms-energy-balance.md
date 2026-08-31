# Relay in-use flag, battery alarms, daily energy balance

_Written 31 Aug 2026. Three items off the open list in the previous
handover. All verified before pushing: `py_compile` + a full venv import
of `app.main`, `tsc --noEmit`, `vite build`, and two new test scripts._

---

## 1. Ron stopped offering circuits that don't exist

**The symptom:** Ron confidently told people to say "turn the heater
on". The heater came off the relay board weeks ago (it runs direct from
the battery now — the 1.4V drop through the board was a measured
contributor to its ignition failures), and the fridge moved to the
Victron load output. Neither is on a relay. He was offering both.

**Why it happened, and why a rename wouldn't have fixed it.** Ron's
capability list and the voice matcher are both built from the live
relay channel list — deliberately, so a rename in the app reaches both
without a redeploy. That design is right, and it's exactly why this
broke: a channel in that list is a channel Ron will offer, under
whatever name it currently has. Renaming channel 4 to "Spare" would
have swapped a wrong offer ("turn the heater on") for a meaningless one
("turn the spare on"), and voice would still have matched it, clicked
a relay with no load behind it, and reported success.

**The fix:** a per-channel `in_use` flag.

- Absent means `True`. A channel configured before this flag existed is
  one that was wired to something, so taking a circuit out of voice
  control has to be a deliberate act, never inferred.
- `in_use: False` excludes the channel from `_voice_controllable_relays()`
  and from `_describe_capabilities()`. That is *all* it does.
- It does **not** release the pin, and does not stop the channel
  working. The pin stays claimed and driven safe at boot, the Switches
  screen still toggles it, and a multimeter on COM/NO still proves the
  board out — all of which you want when a spare is about to have
  something wired to it.

Channel 4 (physical **pin 16**, the old heater channel) ships as
`in_use: False`. `_backfill_new_channel_fields()` pushes it onto the
Pi's saved config on the next start, so this reaches the van without
hand-editing `config.json`.

**Channel 1 (pin 11, TV) is deliberately left `in_use: True`** despite
its board fault. It is a broken circuit to repair, not a decommissioned
one, and marking it unused would hide the thing that still needs fixing.

**Flipping it back:** `PUT /api/relays/{id}/in-use`, or the "Mark as
wired" button on the Switches card. No redeploy.

**Stale defaults also corrected.** `DEFAULT_CHANNELS` and the seeded
config both still said Heater / Lights / Radio-amp / Fridge-TV. They now
say TV / Lights / Amp / Spare, with the physical pin for each in the
comments. These only apply to a fresh install — the Pi's saved config
shadows them — but a lying default is how the next session inherits the
wrong map.

> **One thing to do by hand on the Pi:** channel 4's *name* on the van
> is still "Heater", because a rename is user data and this change
> deliberately doesn't overwrite it. Ron won't offer it any more either
> way, but the Switches screen will still say Heater until you tap the
> name and change it.

### Also: the UI speaks in physical pins now

The Switches card said `GPIO 23`. It now says `Pin 16`, via a full
BCM→physical lookup in `frontend/src/lib/pins.ts`. The van is wired,
labelled and documented in physical pin numbers; the backend only
stores BCM because that's what gpiozero's constructor takes, so the
translation belongs at the point a human reads it.

---

## 2. Battery alarms — `battery_alarm_service.py`

Rebuilt from scratch rather than recovered; the previous draft was
never committed and its test never passed. **Ships disabled.**

Two alarms, both watching BATTERY telemetry:

**SoC below the floor (default 50%).** This is an AGM bank, so 50% is
not "getting low", it's the number that protects the batteries. By 20%
the damage the alarm exists to prevent has already happened.
`BatteryService`'s own 20%/10% alerts are untouched and still fire
below this — the thresholds don't collide because they mean different
things.

**The two batteries diverging (default 0.4V).** No equivalent existed
anywhere. The bank is two AGMs in parallel through an Anderson
connector; the shunt measures the first directly and the second on its
AUX input (voltage only — no current, so no SoC for it, and none is
invented). Two healthy paralleled batteries sit at the same voltage. A
sustained gap means the Anderson connector backing out, the external
battery's breaker tripped from road vibration (a known fault on this
van), or a battery failing. All three are quiet failures — nothing
stops working, the van just starts running on one battery.

### The parts that took the thinking

**Divergence must be SUSTAINED — 10 minutes of continuous readings.**
An instantaneous gap between two paralleled batteries is completely
normal; switch the inverter on and whichever battery carries it sags
for as long as the load lasts. Alarming on a single reading would mean
an alert every time the kettle went on. Ten minutes is the difference
between "a load is running" and "these batteries aren't properly
connected to each other". Any reading back inside the threshold resets
the clock.

**Hysteresis on both.** A value sitting on a threshold flickers across
it, and an alarm that clears and re-raises every minute trains you to
ignore it. Each clears at a deliberately easier level than it raises
(+5% SoC, −0.1V).

**A re-notify ceiling, not a repeat.** Re-sent at most once every 6
hours while a condition lasts. Silence would let a real problem be
forgotten; every reading would be noise.

**The external battery being unplugged is not a fault.** It's
removable. No aux reading resets the sustain timer rather than alarming
or clearing.

**No SoC is not zero SoC.** A missing percentage (no shunt, or a shunt
that hasn't synchronised) is neither an alarm nor a recovery — the same
rule as showing a dash rather than inferring SoC from voltage.

### Delivery

In-app notification always, plus an optional **ntfy.sh** push. ntfy
because it needs no account, no key and no app-store presence — a topic
name is the entire configuration.

**The topic name IS the credential.** ntfy topics are public by name, so
anyone who knows the string can read the van's alerts. It's in
`SECRET_KEYS`, write-only, never echoed back over the tunnel. The
Settings field says so.

A failed push is logged and swallowed. No signal is this van's normal
state, not an error, and it must never stop the in-app notification or
kill the subscriber loop.

### Config

New **top-level `alarms` section**, not extra keys inside
`notifications`. `_load()` shallow-merges, so a stored section fully
shadows its defaults and new sub-keys never reach an install that has
already saved one. A new top-level key merges in cleanly for everybody.

```
alarms: { battery_enabled: false, soc_floor_pct: 50.0,
          divergence_volts: 0.4, renotify_hours: 6,
          ntfy_topic: "", ntfy_server: "https://ntfy.sh" }
```

Settings → Voice & integrations → **Battery alarms** to arm it.

### Tests — `backend/test_battery_alarms.py`

15 assertions, all passing. The clock is injected, so six hours of
re-notify behaviour and ten minutes of sustained divergence take no
wall-clock time. Covers: disabled-by-default, the floor crossing, the
re-notify ceiling, hysteresis wobble, missing SoC, the sustain window,
a load spike resetting the clock, an unplugged external battery, the
two alarms running on independent timers, re-enabling not being muted
by a stale ceiling, and an ntfy failure not swallowing the in-app
alert.

---

## 3. Daily energy balance — `intelligence/providers/energy_balance.py`

`solar_history.py` said plainly why it stopped at harvest: a net figure
needs draw integrated over the same period from stored shunt history,
not an instantaneous reading multiplied out. The shunt has been logging
since 29 August, so that integration is now possible from measurements
alone.

Reports, per day: **net Wh**, **charge Wh**, **discharge Wh**, and a
**coverage fraction**. Warns on a sustained deficit and projects days to
the 50% floor.

### What is deliberately NOT reported

**Total household load.** The shunt sees the net at the battery post, so
a 40W load behind a 100W array reads as +60W and the load itself is
invisible. It could be recovered as (solar in − net) only if solar were
the sole charge source, and it isn't — the DC-DC charger tops up while
driving and a mains charger does at home, neither logged as solar. That
would quietly understate the load on exactly the days it was most
interesting. Harvest is measured, net is measured, load isn't.

### The two things that would have made it silently wrong

**The MPPT's merged copy.** The MPPT also publishes BATTERY, the bus
merges payloads by precedence *before* anything is persisted, and so an
MPPT-sourced row carries a copy of the shunt's last `power_w`.
Integrating both sources would count stretches of the day twice, weighted
by whichever device happened to broadcast more often. Filtered to
`source == victron_shunt`. One device, one series. There's a test that
fails without it.

**Gaps.** Integrating a gappy series produces a confidently wrong daily
total. If Bluetooth drops for eight hours — and it has, for nine hours
straight when the Pi's controller locked up — the remaining sixteen
integrate to a number that looks entirely plausible and is a third
short, with nothing in the figure to say so. So gaps over 5 minutes are
excluded rather than bridged, every day carries a coverage fraction, and
days below **80% coverage** are never averaged, projected from or warned
about. A day the van couldn't see is not a day with a low number in it.
Excluded days are counted and surfaced, not silently dropped.

Today is reported separately, with its coverage measured against elapsed
time rather than 24h — otherwise every morning would look like an outage.

### Tests — `backend/test_energy_balance.py`

28 assertions, all passing. The arithmetic is checked against totals
worked by hand (10W for 24h = −240 Wh, this van's measured base load),
plus the double-counting guard, gap handling, nulls not reading as 0W,
low-coverage exclusion, the deficit projection, and "not enough data
yet" saying so rather than guessing.

---

## Also fixed on the way past

`backend/test_roof_safety.py` **was completely broken** and had been for
a while — its `FakeRelays.set()` didn't accept the `source` argument the
real `RelayService.set()` gained when the relay audit trail was added,
so every test in the file died on a `TypeError` before asserting
anything. A stale fake had silently disabled the roof safety suite: the
one suite that most needs to run. Two lines. All nine roof tests pass
again.

Worth generalising: the roof tests are only run by hand, so nothing
noticed. If any of these three test scripts is going to be trusted
later, they need running when the code around them changes, not when
someone remembers.

---

## Deploy

Frontend changed, so this is a full build:

```
cd ~/bongo-control
git pull
docker compose --profile cloudflare-tunnel up -d --build --remove-orphans
```

Hard refresh or reinstall the PWA afterwards (service worker caching).

**After deploying:** rename channel 4 from "Heater" to something honest
on the Switches screen, and if you want phone alerts, Settings → Voice &
integrations → Battery alarms.

---

## The spare relay (pin 16), unresolved

Frankie asked what to do with it now the heater is gone. Not decided —
noted here so it isn't re-litigated from scratch:

- **Leave it spare.** It's the only free channel. If the heater is
  replaced, the *wired* B2010 controller protocol (the Afterburner
  project decoded it) is a better integration route than a relay anyway.
- **Water pump** or **inverter remote-on** are the conventional uses.
- **Or rob it for the TV circuit.** Pin 11 has the board fault. Moving
  that load onto a known-good channel is quicker than wiring the spare
  5V relay module, and costs the spare.

---

## Follow-up: pooled bank capacity (`battery_bank_service.py`)

Frankie's ask: when the external battery is connected, the runtime
estimate should reflect the combined amp-hours.

**What was actually wrong.** Every "how long will this last" figure
divided by one hardcoded `NOMINAL_BANK_WH = 100 * 12.8`, duplicated
across three files. Wrong twice: the leisure battery is 120Ah not 100Ah,
and the 130Ah external one spends much of its life paralleled on. With
both connected the van had more than twice the energy the estimate
assumed. Now a single service, so the runtime estimate, days-to-floor
and anything added later can't disagree.

Capacities are in a new `battery_bank` config section (120 / 130,
editable in Settings → Battery alarms).

### Detecting "connected" — the bit that matters

Not "is there an aux reading". The sense wire keeps reporting a healthy
12.8V off a battery whose Anderson connector has backed out or whose
breaker has tripped from vibration — both known faults on this van, and
exactly what the divergence alarm exists to catch. A battery that is
present but not connected contributes nothing, and counting it would
promise runtime that doesn't exist.

The test is **voltage agreement**: two genuinely paralleled batteries are
the same electrical node and must read the same. The threshold is read
from the *same* `alarms.divergence_volts` the alarm uses, so the app can
never simultaneously warn that the batteries are disconnected and count
the capacity of one of them.

Agreement is strong under load or charge (a disconnected battery diverges
within seconds once current flows) and weak at rest (two disconnected
batteries can both sit at 12.7V). That ambiguity is reported via a
`confident` flag rather than hidden. The estimate carries its assumption
— "250Ah bank — external battery connected" — into the existing
`confidence` field, which the Overview predictions card already renders.
Without it the number appears to double for no reason.

### Two things this does NOT fix, established while working it out

**`soc_pct` is computed inside the shunt**, against the capacity set in
VictronConnect, and arrives already calculated. If the shunt is set to
one battery while two are connected, its percentage is wrong at source
and no arithmetic in the app corrects it — only VictronConnect can.
**Worth checking what the shunt is configured for.** What this service
does is stop the app compounding it by converting that percentage to
watt-hours with the wrong capacity.

**The external battery's 130W panel is invisible to the shunt.** Its PWM
controller is wired directly to the battery terminals, so the charge loop
closes at the posts, upstream of the sense element. Because the Anderson
parallels both batteries, that panel charges the *whole bank* unmeasured.
`consumed_ah` therefore over-counts — energy goes in unseen and comes out
seen — so SoC reads lower than reality. Partly self-limiting, since the
shunt resets `consumed_ah` on a full-charge sync; the worst drift is
spring and autumn, when there's enough sun to matter but not enough to
reach a sync.

Fixing it is one wire: move the PWM's negative from the battery post to
the shunt's SYSTEM MINUS stud. The cost is that the panel then does
nothing while the battery is detached from the van, which may be the
whole point of it having its own panel. Left as-is deliberately.

**And the two are mutually exclusive.** For the shunt to measure the
combined bank as one battery, both negatives must be on BATTERY MINUS —
which is precisely what puts the PWM on the unmeasured side. Wiring the
external negative to SYSTEM MINUS would count some of that solar, but
then the shunt treats the external battery as part of the *system*,
`soc_pct` tracks the leisure battery alone, and pooled capacity breaks.
Pooling is the more useful of the two. **Still unconfirmed which stud the
external negative is actually on** — worth checking, because if it's on
system minus, the pooling is wrong in a way nothing here detects.

### Tests — `backend/test_battery_bank.py`

20 assertions. The important one is case 3: a present-but-diverging
battery is *not* counted. Also covers the shared threshold, at-rest
uncertainty, config-driven capacities, and garbage values never producing
a bigger bank.

`test_energy_balance.py` gained a `FakeBank` and a case proving
days-to-floor roughly doubles with 250Ah connected — same deficit, same
data, only the capacity differs.

> Note: adding the constructor argument broke `test_energy_balance.py`
> immediately — the same stale-fake failure that had silently disabled
> the roof suite for weeks. It was caught this time only because the
> suites were run. **Run all four after touching any constructor.**
