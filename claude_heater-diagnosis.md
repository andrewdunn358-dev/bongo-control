# Diesel heater — corrected diagnosis

_31 Aug 2026. **Supersedes the heater section of every earlier note**,
including the "Eliminated, in order" list in the 31 Aug handover. That
list contained at least one item that was never actually done._

---

## THE CORRECTION — the fuel pump was never replaced

Earlier notes record the fuel pump as replaced and therefore eliminated.
**It wasn't.** A new 22mL pump was bought and never fitted: its
**electrical connector** didn't match the existing harness, so the old
pump stayed in place. Everything since has been tested with the original
pump fitted.

That is a plug shape, not an incompatibility. A two-wire solenoid pump
doesn't care what connector it arrives with. Either splice the new pump
onto the existing harness directly, or cut the old connector off with a
short tail and splice that onto the new pump — which keeps it
plug-compatible with the ECU and reversible.

**So the pump is back on the suspect list, near the top.** A weakening
pump delivers a short dose per stroke: weak flame, white smoke, low body
temperature, and a failure time that doesn't move with the power setting.
That is the entire observed symptom set.

Watch the displacement marking when fitting — these are rated per 100
strokes (~22mL for a 2kW unit) and the ECU doses against that figure. A
pump with a different rating produces these symptoms by itself. Check the
marking on the OLD pump and match it, rather than trusting what arrived.

Prime with the manual pump test (Setting + Down together on the B2010)
until fuel reaches the heater before attempting a real start. An unprimed
first run throws the same fault and tells you nothing.

---

## Fuel supply — the part no earlier note recorded at all

**The heater is fed from the vehicle's own fuel line, via a T junction
with a non-return valve.** Not a standpipe in the tank.

This is the arrangement heater manufacturers explicitly advise against,
and it was missing from every previous write-up — which matters, because
half the diagnosis so far assumed a normal dedicated pickup.

### Frankie's counter-argument, which is half right

> "Even when it was working it was set up like this, and I can see the
> fuel flowing OK through the pipe."

**The first half is strong.** A plumbing arrangement that ran fine for a
season is not a plausible sole cause of a failure that appeared later.
Topology alone doesn't explain it.

**The second half is weak.** These pumps meter a few millilitres a
minute. Starvation looks like slightly smaller slugs, not like no flow —
you cannot distinguish 100% of correct dose from 70% by eye, and 70%
would produce exactly the weak flame and cold casing observed.

**The reconciliation:** a supply path can degrade without its topology
changing. A non-return valve stiffening, or a partial restriction
building at the tee, takes a system that was marginal-but-adequate and
pushes it under. That also explains why fitting a new pump would have
changed nothing — a new pump pulling against the same restriction behaves
the same. (Moot, since it was never fitted.)

---

## Why the nine minutes matters

Failure is consistent at ~9 minutes. **Random ignition faults don't keep
time; something reaching a threshold does.**

The apparent problem with a fuel-volume explanation is that it fails at
nine minutes at *every* power level — higher power should empty a fixed
reservoir sooner.

**It resolves cleanly if the supply is what's limiting the fuel rate
rather than the demand.** Then turning the power up doesn't increase
consumption: the heater burns weakly at whatever setting is chosen, which
is precisely the white smoke and 64°C casing. Starvation makes the power
setting irrelevant, so the timing stays constant.

That was the loose thread in the fuel theory, and it ties up. It applies
equally to a weak pump and to a restricted supply — it does not
distinguish between them.

---

## Flame sensor — eliminated, properly

Considered as a cause (a sensor under-reading could stall the ECU's start
ramp). **Ruled out:** the B2010 displays two temperatures, van and heater
body, and the body reading climbs and lands around the 64°C measured
independently with a meter. Working and calibrated.

This makes the fuel case stronger, not weaker: a trustworthy sensor
reporting 64°C means the weak burn is real rather than a misread.

For reference, if it ever needs testing: unplug, measure resistance cold,
dip the metal tip in freshly boiled water, watch it move smoothly and
settle, and check it returns on cooling. Also continuity-test the harness
while wiggling it — a corroded pin gives identical symptoms. Use hot
water, not a naked flame, near an open fuel system.

---

## Tests, in the order worth doing

1. **Fit the new pump** (splice the connector). It is the item wrongly
   believed eliminated, and it is a strong fit for the symptoms.
2. **Bottle test.** Pull the pickup off the tee entirely and drop it into
   a container of clean diesel beside the pump. Bypasses the tee, the
   non-return valve and the shared line in one move. Runs past nine
   minutes → the supply path is the fault and the heater is fine. Fails
   again → the supply is exonerated.
3. **Measured pump comparison** — the test that settles the restriction
   question without needing anyone's spec sheet. Run the manual pump test
   into a measuring container for a fixed count, connected normally. Note
   the volume. Repeat the identical count with the pickup in a bottle.
   Same volume → the supply delivers everything asked for. Less through
   the tee → the restriction is real regardless of how the flow looks.
   Self-calibrating, so the exact mL-per-stroke figure doesn't matter.
4. **Tank vent** — run with the filler cap loose. Free, no tools. A
   blocked vent builds vacuum and tails flow off over minutes.
5. **Log body temperature every minute** through any run. The curve
   separates the remaining cases: climbs then flattens low and drops →
   supply tailing off; climbs then falls off a cliff → flame going out
   (the E-08 story); never really climbs → never establishing.

---

## Status of everything else

**Genuinely eliminated:** leaking fuel hose (found, replaced), glow plug
(replaced, came out barely dirty), mesh screen (replaced), burner chamber
(clean, no significant carbon), exhaust and intake (clear, correctly
routed, well separated), fan (ramps correctly), relay board and switches
(bypassed entirely), flame sensor (above), and **voltage** — a real fault
that was fixed in stages, from 11.2V at the heater to a steady 11.9V via
a dedicated negative return to the shunt's system stud. Well above the
10V threshold; not the current cause.

**Not eliminated:** the fuel pump (never fitted), the supply path (tee +
non-return valve), the ECU, and the parameter menu (password not in the
supplied manual).

**Warranty is dead** — too much time has passed. Do not spend more effort
drafting the claim; the earlier note about a Consumer Rights Act
durability argument is no longer live.

**On order:** new wiring loom.

**If replacement becomes the answer:** ~£128 for a complete 2kW kit.
Check the mounting plate bolt spacing and aperture against the existing
floor hole before ordering.

**Proper fix for the supply, if it turns out to be implicated:** a
standpipe into the tank, pump mounted low and close to the tank, outlet
angled upward. Long suction runs are what kill these pumps.

---

## The lesson, for the next session

An item on an "eliminated" list is only eliminated if someone watched it
happen. The pump sat on that list for weeks because a part was *bought*,
and buying got recorded as fitting. Every subsequent theory was built on
top of that, and the whole supply arrangement — a tee into the vehicle's
fuel line, behind a non-return valve — was never written down at all.

Same failure as the stale code comments swept out on the same day: the
note said something that used to be on its way to being true.
