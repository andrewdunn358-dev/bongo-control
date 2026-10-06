"""What the van is actually drawing, in 10-minute blocks, from VanOS's own
history DB. Use it for before/after checks (e.g. voice control off).

    docker compose exec -T backend python - < backend/tools/power_report.py
Optional: HOURS=6 (default 3), BLOCK=10 (minutes).

The shunt sees the battery only: + = charging, - = discharging. In
daylight solar hides the load, so the real load is worked out as
    load W = solar W - battery W
(solar W is the charge controller's figure; close enough for a
before/after comparison, not a meter).
"""
import json
import os
import sqlite3
import time
from collections import defaultdict
from datetime import datetime
from statistics import median
from zoneinfo import ZoneInfo

LONDON = ZoneInfo("Europe/London")
HOURS = float(os.environ.get("HOURS", "3"))
BLOCK = int(os.environ.get("BLOCK", "10")) * 60
DB = os.environ.get("VANOS_DB", "/app/data/vanos.db")
since = time.time() - HOURS * 3600

con = sqlite3.connect(DB)


def rows(domain):
    for ts, src, pj in con.execute(
        "SELECT timestamp, source, payload_json FROM telemetry_readings "
        "WHERE domain=? AND timestamp>=? ORDER BY timestamp", (domain, since)
    ):
        d = json.loads(pj)
        yield ts, (src or "").lower(), d.get("payload", d)


bat = defaultdict(list)    # block -> [(amps, watts, volts)]
sol = defaultdict(list)    # block -> [solar W]
mifi = defaultdict(list)   # block -> [W on the MPPT load output = the MiFi]
for ts, src, p in rows("battery"):
    if "shunt" not in src:
        continue
    a, v = p.get("current_a"), p.get("voltage")
    w = p.get("power_w")
    if w is None and a is not None and v is not None:
        w = a * v
    if a is not None:
        bat[int(ts // BLOCK)].append((a, w, v))
for ts, src, p in rows("solar"):
    if p.get("watts") is not None:
        sol[int(ts // BLOCK)].append(p["watts"])
    lw = p.get("load_power_w")
    if lw is None and p.get("load_current_a") is not None:
        lw = p["load_current_a"] * 12.2
    if lw is not None:
        mifi[int(ts // BLOCK)].append(lw)

print(f"{'Block':<7} {'Batt A':>7} {'Batt W':>7} {'Solar W':>8} {'LOAD W':>7} {'LOAD A':>7} {'Batt V':>7} {'MiFi W':>7} {'REST W':>7}")
for b in sorted(set(bat) | set(sol)):
    when = datetime.fromtimestamp(b * BLOCK, LONDON).strftime("%H:%M")
    bs = bat.get(b, [])
    a = median(x[0] for x in bs) if bs else None
    w = median(x[1] for x in bs if x[1] is not None) if any(x[1] is not None for x in bs) else None
    v = median(x[2] for x in bs if x[2] is not None) if any(x[2] is not None for x in bs) else None
    s = median(sol[b]) if sol.get(b) else 0.0
    load = (s - w) if w is not None else None
    load_a = (load / v) if load is not None and v else None
    f = lambda x, d=1: "-" if x is None else f"{x:.{d}f}"
    m = median(mifi[b]) if mifi.get(b) else None
    rest = (load - m) if load is not None and m is not None else None
    print(f"{when:<7} {f(a,2):>7} {f(w):>7} {f(s):>8} {f(load):>7} {f(load_a,2):>7} {f(v,2):>7} {f(m):>7} {f(rest):>7}")

try:
    print("\nPi load average (1/5/15 min):", open("/proc/loadavg").read().split()[:3])
except OSError:
    pass
