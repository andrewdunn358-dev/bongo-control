# Hcalory 2kW diesel heater — manual (photographed 3 Oct 2026)

Photos of the paper manual are in this folder (`p03`…`p17`), plus the panel
showing "SET EE-". Key content transcribed below so it is searchable.

## Power (p06, p08)
- 12V or 24V DC. Supply should be rated **>15A**: "the device needs to heat the
  glow plug when starting, and the operating current may **reach 12A** and last
  for 3–5 minutes." After ignition it needs only **1–4A**.
- 12V controller range **9–16V**. 2kW and 5kW controllers are not interchangeable.
- Never cut power to stop it: shutdown runs a 3–5 min cool-down ("OFF" on screen).

## Start sequence (p03)
Glow plug heats for 1–3 min, then fan and pump start; atomised diesel ignites on
the hot plug. Preheat + ignition stage is 3–5 min.

## Panel keys (p09)
1 ▲ add · 2 ⏻ on/off · 3 ▼ reduce · 4 OK · 5 ⚙ set.
Icons: fan, glow plug, oil pump, altitude, timer (clock), fault ⚠, auto
start/stop (A), CO alarm, high-temp alarm, ventilation, manual mode,
constant-temperature mode, sensor failure, power failure, Bluetooth.

## Operation (p10–p13)
| Function | Keys |
|---|---|
| Start / stop | hold ⏻ 2s |
| Manual mode gears H1–H10 | ▲ / ▼ |
| Constant temperature (0–40°C) | ▲ / ▼; hold ⚙ 2s to switch manual ↔ constant |
| **Auto start/stop** (constant-temp mode only) | short-press ⏻ → (A) icon on/off. Default: **on at set −4°C, off at set +3°C** (e.g. 24°C set → off at 27, on at 20) |
| Ventilation (from shutdown) | hold ⚙ 2s; ▲/▼ fan speed; hold ⚙ or ⏻ 2s to exit |
| Cycle display data (on state) | short OK: housing temp → voltage → ambient temp → gear/set temp |
| °C / °F | hold ⏻ + ▲ 2s |
| **Manual pump (priming)** (shutdown) | hold ▲ + ▼ — pumps while held. Use with caution |
| Altitude mode | hold ⚙ + OK 2s: mode 1 → mode 2 → off. Adjusts wind/oil ratio |
| **Timer** | hold OK + ▼ 2s **toggles**: if off → turns ON and opens setup ("OPEN" start time, "CLOS" stop time, 00:00–23:59; ⏻ moves digit, OK saves, ⚙ don't save, 10s auto-save). If on → **all timers off**, clock icon goes out |
| Clock set | hold OK 2s → "CLOC"; then week setting shows **"EE-1"** (day of week) — "EE" is NOT a fault. App syncs clock on BT connect |
| Pair 433MHz remote | ⏻ + ▼ 2s (shutdown) |
| Screen brightness | ▲ + ▼ 2s (on state) |
| Show BT password | OK + ▲ (default **0000**) |
| Reset BT password | OK + ⏻ 2s (shutdown), password **3333** |
| **Pump frequency** (use with caution) | OK + ⏻ 2s (shutdown), password **3638**. Shows e.g. "1-2.0" = gear 1 at 2.0Hz (gear 10 shown as A). ▲/▼ change, ⏻ next gear, OK confirm, ⚙ cancel |
| Pump frequency reset to factory | OK + ⏻ 2s (shutdown), password **6666** |
| Fault display | "E-xx" with fault icon flashing |

## Fault list (p15–p16)
| Code | Meaning | Checks |
|---|---|---|
| E021 | Supply voltage too low | battery lead damaged / plug secure; fuse ageing |
| E022 | Supply voltage too high | battery output |
| E023 | Supply voltage abnormal | battery output |
| E031 | Glow plug open circuit | wire/plug loose or broken; power plug separately to test |
| E032 | Glow plug short | wire short; plug damaged or board misreads |
| E041 | Oil pump open circuit | wires/connectors; pump damaged |
| E042 | Oil pump short | wire short; pump blocked/damaged |
| E05 | High temp (case >230°C) | cold air inlet blocked; hot air outlet bent/blocked; fan; sensor |
| E061 | Motor open circuit | wire/plug; power motor separately |
| E062 | Motor short | wire; motor or board |
| E063 | Fan speed abnormal | impeller stuck; magnet–Hall sensor gap too large |
| E07 | Board ↔ panel comms | panel connector loose; blue wire broken |
| **E08** | **Flameout** | 1) oil shortage, low-temp solidification, line blocked/folded, too many bubbles (steam drums) in line, pump jam · 2) oxygen intake and exhaust ducts clear · 3) **housing temperature sensor in full contact with housing, pressure spring strong** · 4) sensor damaged |
| E091 | Temp sensor open | wire/plug; sensor |
| E092 | Temp sensor short | wire; sensor |
| **E10** | **Start-up unsuccessful** | 1) housing too hot and can't cool within 3 min of start · 2) **lots of white smoke**: 2.1 clean/replace the **filter screen next to the glow plug**; 2.2 pump spraying effectively; 2.3 **glow plug ageing** · 3) little/no smoke: 3.1 fuel missing / line frozen or blocked; 3.2 pump stuck/damaged; 3.3 intake & exhaust clear; 3.4 glow plug damaged; 3.5 inner fan wheel gap too large · 4) **ignition normal but still reports failure: housing temperature sensor full contact / spring strong; sensor normal** |

## Use (p17)
No bends/pressure/blockages in any duct. If hot and fan can't run, blow cold air
into the combustion intake to get the body below 80°C. Pump frequency changes
"by professionals". Hot-air outlet can exceed 150°C, exhaust 270°C.

## Our observations (2–3 Oct 2026) against this manual
- Lights every attempt, dies ~1 min after glow ends → E08/E10.
- **Lots of white smoke** on failed starts → E10 branch 2 (screen / pump / ageing glow plug).
- Glow-phase current measured at the shunt **~6.5–7.5A**, vs manual "may reach 12A".
- Only successful starts began with the housing already warm (42–44°C).
- New 12AWG feed raised heater-reported glow voltage 10V → 11V; no change in outcome.
- Panel timer was off (OK+▼ showed OPEN); app timer list empty; auto start/stop off.
  Yet unattended starts at ~00:00 on Wed, Thu night and Sat — cause not found.
