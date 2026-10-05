"""Heater start history: one line per start, from VanOS's own history DB.

Run on the Pi (reads the script from the host, runs it in the backend):
    docker compose exec -T backend python - < backend/tools/heater_report.py
Optional: DAYS=14 to look further back.
"""
import json
import os
import sqlite3
import time
from datetime import datetime
from zoneinfo import ZoneInfo

LONDON = ZoneInfo("Europe/London")

DAYS = float(os.environ.get("DAYS", "7"))
DB = os.environ.get("VANOS_DB", "/app/data/vanos.db")
since = time.time() - DAYS * 86400

con = sqlite3.connect(DB)
rows = con.execute(
    "SELECT timestamp, payload_json FROM telemetry_readings "
    "WHERE domain='heating' AND timestamp>=? ORDER BY timestamp", (since,)
).fetchall()
bat = con.execute(
    "SELECT timestamp, source, payload_json FROM telemetry_readings "
    "WHERE domain='battery' AND timestamp>=? ORDER BY timestamp", (since,)
).fetchall()

battery = []
currents = []  # (ts, amps) - negative = discharging. All sources carry the shunt's merged fields.
for ts, src, pj in bat:
    p = json.loads(pj).get("payload", json.loads(pj))
    c = p.get("current_a")
    if c is not None:
        currents.append((ts, c))
    if "shunt" not in (src or "").lower():
        continue
    v = p.get("voltage")
    if v is not None:
        battery.append((ts, v))


def battery_min(t0, t1):
    vals = [v for ts, v in battery if t0 - 30 <= ts <= t1 + 30]
    return min(vals) if vals else None


def get(p, *keys):
    for k in keys:
        if p.get(k) is not None:
            return p[k]
    return None


samples = []
for ts, pj in rows:
    d = json.loads(pj)
    p = d.get("payload", d)
    samples.append({
        "ts": ts,
        "state": get(p, "state"),
        "step": get(p, "running_step"),
        "err": get(p, "error_code") or 0,
        "body": get(p, "body_temperature_c"),
        "v": get(p, "voltage"),
    })

# A start = entering heating (state 8) from anything else. It ends at the
# next fault, cooldown or off.
starts = []
cur = None
for s in samples:
    heating = s["state"] == 8
    if heating and cur is None:
        cur = {"t0": s["ts"], "body0": s["body"], "samples": []}
    if cur is not None:
        cur["samples"].append(s)
        if not heating:
            cur["t1"] = s["ts"]
            cur["end_state"] = s["state"]
            cur["err"] = s["err"]
            starts.append(cur)
            cur = None
if cur is not None:
    cur["t1"] = cur["samples"][-1]["ts"]
    cur["end_state"] = 8
    cur["err"] = 0
    starts.append(cur)

print(f"{'When':<12} {'Result':<8} {'Glows':>5} {'Body start':>10} {'Body max':>8} {'Ran':>6} "
      f"{'Heater V glow':>13} {'Batt V glow':>11} {'Code':>5}")
for st in starts:
    ss = st["samples"]
    bodies = [s["body"] for s in ss if s["body"] is not None]
    bmax = max(bodies) if bodies else None
    glows = sum(1 for a, b in zip([None] + ss, ss)
                if b["step"] in (2, 0) and (a is None or a["step"] not in (2, 0)))
    glow_v = [s["v"] for s in ss if s["step"] in (2, 0) and s["v"]]
    run_ts = [s["ts"] for s in ss if s["step"] == 3]
    ran = (max(run_ts) - min(run_ts)) / 60 if len(run_ts) > 1 else 0
    glow_ts = [s["ts"] for s in ss if s["step"] in (2, 0)]
    bv = battery_min(min(glow_ts), max(glow_ts)) if glow_ts else None
    if bmax is not None and bmax >= 100:
        result = "WORKED"
    elif st["end_state"] == 15 or st["err"]:
        result = "FAILED"
    else:
        result = "STOPPED"
    when = datetime.fromtimestamp(st["t0"], LONDON).strftime("%a %H:%M")
    code = f"E{int(st['err']):02d}" if st["err"] else "-"
    print(f"{when:<12} {result:<8} {glows:>5} {str(st['body0']):>10} {str(bmax):>8} {ran:>5.0f}m "
          f"{(str(min(glow_v)) if glow_v else '-'):>13} {(f'{bv:.2f}' if bv else '-'):>11} {code:>5}")
print(f"\n{len(starts)} starts in the last {DAYS:g} days")


# ---- Glow-plug draw ----------------------------------------------------
# The shunt measures everything leaving the leisure battery, not the heater
# alone. So: baseline = typical current in the few minutes BEFORE the start
# (Pi, MiFi, fridge, minus any solar), glow draw = baseline minus the
# deepest discharge seen while the heater is in its glow phase. What is left
# is the heater during glow: glow plug plus its slow pre-heat fan/controller.
# Readings are 1-2 minute snapshots, so it is an estimate, not a meter.
import statistics


def amps_between(t0, t1):
    return [c for ts, c in currents if t0 <= ts <= t1]


print("\nGLOW DRAW (per glow phase)")
print(f"{'When':<12} {'Baseline A':>10} {'Glow total A':>12} {'Heater A':>9} {'Batt V min':>10} {'Heater V':>8}")
for st in starts:
    ss = st["samples"]
    # split into glow phases: consecutive samples with step 2/0 while heating
    phases, cur_p = [], []
    for x in ss:
        if x["state"] == 8 and x["step"] in (2, 0):
            cur_p.append(x)
        elif cur_p:
            phases.append(cur_p)
            cur_p = []
    if cur_p:
        phases.append(cur_p)
    base_vals = amps_between(st["t0"] - 300, st["t0"] - 15)
    base = statistics.median(base_vals) if base_vals else None
    for ph in phases:
        a, b = ph[0]["ts"] - 30, ph[-1]["ts"] + 60
        vals = amps_between(a, b)
        if not vals or base is None:
            continue
        deepest = min(vals)
        heater = base - deepest
        vmin = battery_min(a, b)
        hv = min(x["v"] for x in ph if x["v"]) if any(x["v"] for x in ph) else None
        when = datetime.fromtimestamp(ph[0]["ts"], LONDON).strftime("%a %H:%M")
        print(f"{when:<12} {base:>10.2f} {deepest:>12.2f} {heater:>9.2f} "
              f"{(f'{vmin:.2f}' if vmin else '-'):>10} {str(hv):>8}")
