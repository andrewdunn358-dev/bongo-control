"""Every raw reading in a time window: battery (shunt) volts/amps and the
heater's state, side by side, so short dips during glow are visible
(the 10-minute report averages them away).

    FROM="2026-10-06 20:55" TO="2026-10-06 21:20" \
      docker compose exec -T -e FROM -e TO backend python - < backend/tools/heater_window.py
Times are UK local.
"""
import json
import os
import sqlite3
from datetime import datetime
from zoneinfo import ZoneInfo

LONDON = ZoneInfo("Europe/London")
DB = os.environ.get("VANOS_DB", "/app/data/vanos.db")
t0 = datetime.strptime(os.environ["FROM"], "%Y-%m-%d %H:%M").replace(tzinfo=LONDON).timestamp()
t1 = datetime.strptime(os.environ["TO"], "%Y-%m-%d %H:%M").replace(tzinfo=LONDON).timestamp()

STATE = {0x0: "off", 0x4: "cooling", 0x8: "heating", 0xC: "fan", 0xF: "FAULT"}
STEP = {0: "ign", 2: "glow", 3: "run", 6: "start"}

con = sqlite3.connect(DB)
rows = con.execute(
    "SELECT timestamp, domain, source, payload_json FROM telemetry_readings "
    "WHERE domain IN ('battery','heating') AND timestamp BETWEEN ? AND ? ORDER BY timestamp",
    (t0, t1),
).fetchall()

print(f"{'Time':<9} {'Batt V':>6} {'Batt A':>7}   Heater")
last_heater = None
for ts, dom, src, pj in rows:
    d = json.loads(pj)
    p = d.get("payload", d)
    t = datetime.fromtimestamp(ts, LONDON).strftime("%H:%M:%S")
    if dom == "battery":
        if "shunt" not in (src or "").lower():
            continue
        v, a = p.get("voltage"), p.get("current_a")
        print(f"{t:<9} {v if v is not None else '-':>6} {a if a is not None else '-':>7}")
    else:
        st = p.get("state")
        desc = f"{STATE.get(st, st)}/{STEP.get(p.get('running_step'), p.get('running_step'))}" \
               f" body {p.get('body_temperature_c')}C heaterV {p.get('voltage')}"
        if p.get("error_code"):
            desc += f" E{int(p['error_code']):02d}"
        if desc != last_heater:
            print(f"{t:<9} {'':>6} {'':>7}   {desc}")
            last_heater = desc
